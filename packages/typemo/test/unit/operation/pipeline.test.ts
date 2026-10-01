/*
 * The operation pipeline — fixed slot order, pass-through slots, the error path (`onError` on every step in
 * reverse order, `failedStep`), and the cursor protocol.
 */
import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  type InstrumentationEvent,
  InstrumentationHub,
  OperationContext,
  type OperationEnvironment,
  OperationPipeline,
  type OperationStep,
  PassThroughStep,
  SchemaCompiler,
  STEP_ORDER,
  StandardPipeline,
  type StepName,
} from "../../../src/internal.ts";
import { ResolveContextStep } from "../../../src/operation/pipeline/steps/resolve-context-step.ts";
import type { FindPlan } from "../../../src/query/plan.ts";
import { Hooked } from "../../fixtures/model/hooked-entities.ts";
import { Person } from "../../fixtures/model/model-entities.ts";

const hub = new InstrumentationHub(undefined);
const environment: OperationEnvironment = {
  ready: () => undefined,
  driver: {} as OperationEnvironment["driver"],
  instrumentation: hub,
  connectionName: "unit",
  owner: {},
  linksDriverCommands: () => false,
  validateReads: false,
  schemaOfCollection: () => undefined,
};

const plan: FindPlan = Object.freeze({
  op: "find",
  entity: Person,
  options: Object.freeze({}),
  filter: Object.freeze({ name: "Ann" }),
  populate: [],
  lean: false,
  orFail: false,
  mode: { kind: "run" } as const,
});

/** A fresh `OperationContext` over the find plan above. */
const context = (mode: "run" | "cursor" = "run") =>
  new OperationContext({
    plan,
    mode,
    target: { entity: Person, schema: SchemaCompiler.compileModel(Person), collection: "m_people", database: "unit" },
    environment,
  });

/** A step that logs its `run` and `onError` calls and can be told to fail. */
class Recorder implements OperationStep {
  constructor(
    readonly name: StepName,
    readonly log: string[],
    readonly fail = false,
  ) {}

  run(): void {
    this.log.push(`run ${this.name}`);
    if (this.fail) throw new Error(`${this.name} failed`);
  }

  onError(ctx: OperationContext): void {
    this.log.push(`onError ${this.name} (failed ${ctx.failedStep})`);
  }
}

/** A pipeline of `Recorder` steps in every slot; the step `failAt` throws. */
const recording = (log: string[], failAt?: StepName): OperationPipeline =>
  new OperationPipeline(Object.fromEntries(STEP_ORDER.map((name) => [name, new Recorder(name, log, name === failAt)])));

describe("OperationPipeline", () => {
  test("runs the 16 slots in their fixed order", async () => {
    const log: string[] = [];
    await recording(log).run(context());
    expect(log).toEqual(STEP_ORDER.map((name) => `run ${name}`));
    expect(STEP_ORDER).toEqual([
      "resolveContext",
      "validateOptions",
      "normalize",
      "resolvePaths",
      "cast",
      "policies",
      "defaults",
      "validate",
      "hooksPre",
      "instrumentStart",
      "execute",
      "postProcess",
      "populate",
      "audit",
      "hooksPost",
      "instrumentEnd",
    ]);
  });

  test("an empty slot is a pass-through step; a step in the wrong slot is refused", () => {
    const pipeline = new OperationPipeline({});
    expect(pipeline.steps.every((step) => step instanceof PassThroughStep)).toBe(true);
    expect(() => new OperationPipeline({ cast: new PassThroughStep("validate") })).toThrow(
      /"validate" was put into the slot "cast"/,
    );
  });

  test("a failing step: the later steps do not run, onError runs on EVERY step in reverse order, the error is rethrown", async () => {
    const log: string[] = [];
    const ctx = context();
    await expect(recording(log, "cast").run(ctx)).rejects.toThrow("cast failed");
    const runs = log.filter((line) => line.startsWith("run"));
    expect(runs).toEqual(STEP_ORDER.slice(0, STEP_ORDER.indexOf("cast") + 1).map((name) => `run ${name}`));
    const errors = log.filter((line) => line.startsWith("onError"));
    expect(errors).toEqual([...STEP_ORDER].reverse().map((name) => `onError ${name} (failed cast)`));
    expect(ctx.failedStep).toBe("cast");
    expect((ctx.error as Error).message).toBe("cast failed");
  });

  test("an error thrown by onError replaces the operation's error (a postError hook may translate it)", async () => {
    const translate: OperationStep = {
      name: "hooksPost",
      run: () => {},
      onError: () => {
        throw new Error("translated");
      },
    };
    const pipeline = new OperationPipeline({
      execute: {
        name: "execute",
        run: () => {
          throw new Error("original");
        },
      },
      hooksPost: translate,
    });
    await expect(pipeline.run(context())).rejects.toThrow("translated");
  });

  test("with() replaces slots and keeps the others", async () => {
    const log: string[] = [];
    const pipeline = recording(log).with({ cast: new PassThroughStep("cast") });
    await pipeline.run(context());
    expect(log).not.toContain("run cast");
    expect(log).toContain("run validate");
  });

  test("cursor protocol: open runs up to execute; processBatch runs postProcess → populate → audit → hooksPost; finish runs instrumentEnd", async () => {
    const log: string[] = [];
    const pipeline = recording(log);
    const ctx = context("cursor");
    await pipeline.open(ctx);
    expect(log.at(-1)).toBe("run execute");
    log.length = 0;
    const processed = await pipeline.processBatch(ctx, [1, 2]);
    expect(processed).toEqual([1, 2]);
    expect(log).toEqual(["run postProcess", "run populate", "run audit", "run hooksPost"]);
    log.length = 0;
    await pipeline.finish(ctx);
    expect(log).toEqual(["run instrumentEnd"]);
  });

  test("synchronous steps create no promise; nested step events only when someone listens", async () => {
    const events: InstrumentationEvent[] = [];
    const pipeline = new OperationPipeline({ cast: new PassThroughStep("cast") });
    await pipeline.run(context());
    expect(events).toEqual([]);
    const subscription = hub.subscribe({ handle: (event) => events.push(event) });
    await pipeline.run(context());
    subscription.unsubscribe();
    expect(events.map((event) => (event.type === "operation.step" ? event.step : event.type))).toEqual([
      "cast",
      "validate",
      "hooksPre",
      "populate",
      "hooksPost",
    ]);
  });

  test("the standard pipeline fills every slot: core steps, populate, audit", () => {
    const names = StandardPipeline.create().steps.map((step) => `${step.name}:${step.constructor.name}`);
    expect(names).toContain("resolveContext:ResolveContextStep");
    expect(names).toContain("execute:ExecuteStep");
    expect(names).toContain("populate:PopulateStep");
    expect(names).toContain("audit:AuditStep");
    expect(names.some((name) => name.endsWith(":PassThroughStep"))).toBe(false);
  });

  test("a step not needed by a model's schema is left out of its run lists (once per schema)", async () => {
    const log: string[] = [];
    const asked: string[] = [];
    const skipped = new (class extends Recorder {
      needed(schema: { readonly name: string }): boolean {
        asked.push(schema.name);
        return false;
      }
    })("audit", log);
    const pipeline = recording(log).with({ audit: skipped });
    await pipeline.run(context());
    await pipeline.run(context());
    expect(log).toEqual([...STEP_ORDER, ...STEP_ORDER].filter((name) => name !== "audit").map((name) => `run ${name}`));
    expect(asked).toEqual(["Person"]);
    /* The error path still reaches every step (onError is not a run-list matter). */
    const failing: string[] = [];
    const broken = recording(failing, "execute").with({
      audit: new (class extends Recorder {
        needed(): boolean {
          return false;
        }
      })("audit", failing),
    });
    await expect(broken.run(context())).rejects.toThrow("execute failed");
    expect(failing).toContain("onError audit (failed execute)");
  });

  test("with an instrumentation subscriber a step not needed is left out too — no run, no step event", async () => {
    const log: string[] = [];
    const pipeline = recording(log).with({
      hooksPre: new (class extends Recorder {
        needed(): boolean {
          return false;
        }
      })("hooksPre", log),
    });
    const events: InstrumentationEvent[] = [];
    const subscription = hub.subscribe({ handle: (event) => events.push(event) });
    try {
      await pipeline.run(context());
    } finally {
      subscription.unsubscribe();
    }
    expect(log).not.toContain("run hooksPre");
    expect(log).toContain("run hooksPost");
    const steps = events.flatMap((event) => (event.type === "operation.step" ? [event.step] : []));
    expect(steps).not.toContain("hooksPre");
    expect(steps).toContain("hooksPost");
  });

  test("the standard steps a plain model does not need — hooks without hooks, audit without audit", () => {
    const schema = SchemaCompiler.compileModel(Person);
    const standard = StandardPipeline.create();
    const needed = (name: StepName) => standard.step(name).needed?.(schema) ?? true;
    expect(needed("hooksPre")).toBe(false);
    expect(needed("hooksPost")).toBe(false);
    expect(needed("audit")).toBe(false);
    expect(needed("execute")).toBe(true);
    const hooked = SchemaCompiler.compileModel(Hooked);
    expect(standard.step("hooksPre").needed?.(hooked)).toBe(true);
    expect(standard.step("hooksPost").needed?.(hooked)).toBe(true);
  });
});

describe("OperationContext", () => {
  test("working values start as the frozen plan values; replacing them does not touch the plan", () => {
    const ctx = context();
    expect(ctx.filter).toBe(plan.filter);
    ctx.filter = { name: "Bob" };
    expect(plan.filter).toEqual({ name: "Ann" });
    expect(ctx.op).toBe("find");
    expect(ctx.hookEvent).toBe("query.find");
  });

  test("reject(): documents of an unordered write are recorded by input index", () => {
    const ctx = context();
    ctx.reject(3, new (class extends Error {})() as never);
    ctx.reject(1, new Error("x") as never);
    expect(ctx.rejected.map((entry) => entry.index)).toEqual([1, 3]);
    expect(ctx.isRejected(3)).toBe(true);
    expect(ctx.isRejected(0)).toBe(false);
  });

  test("resolveContext stays synchronous once the connection is ready; waits (a promise) before", async () => {
    const ready = context();
    expect(new ResolveContextStep().run(ready)).toBeUndefined();
    let resolve: () => void = () => undefined;
    const waiting = new Promise<void>((done) => {
      resolve = done;
    });
    const pending = new OperationContext({
      plan,
      mode: "run",
      target: ready.target,
      environment: { ...environment, ready: () => waiting },
    });
    const out = new ResolveContextStep().run(pending);
    expect(out).toBe(waiting);
    resolve();
    await out;
  });

  test("ids are unique per operation", () => {
    expect(context().id).not.toBe(context().id);
    expect(new ObjectId()).toBeDefined();
  });
});
