/*
 * Pipeline invariants, on the real server:
 * - once a model ran an operation, its schema cannot change — a hook, a plugin, a policy or a discriminator
 *   added later is a `ConfigurationError` (or a frozen table), never a silently stale schema. The pipeline keeps its
 *   per-schema run lists for the life of the process, so a late change must not be possible.
 * - a step that throws synchronously and a step that rejects asynchronously end the same way, in every slot of the
 *   pipeline: the same `postError` hook calls and the same error for the caller.
 * - exactly ONE of `post` / `postError` per operation — wherever it fails: a pre hook, the preparation again
 *   after a hook's `modify`, the driver, a post hook, a step after the post hooks. An error of a post hook (or of a
 *   later step) reaches the caller as it was thrown and runs no `postError` (the operation had succeeded).
 * - a cursor whose `post` hooks ran for a batch — a later failure (`getMore`, `postProcess`, …) runs no
 *   `postError`; the error reaches the caller.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { type FailPointHandle, FailPointHelpers } from "@venloc/typemo-test-kit";
import {
  ConfigurationError,
  ConnectionInternals,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  MetadataBuilder,
  ModelInternals,
  type OperationContext,
  type OperationHookContext,
  type OperationPipeline,
  type OperationStep,
  Plugin,
  Post,
  PostError,
  Pre,
  Prop,
  Schema,
  type SchemaPlugin,
  ServerError,
  STEP_ORDER,
  type StepName,
  StrictModeError,
  Typemo,
} from "../../../src/internal.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("r9_invariants");

describe("the schema of a model that ran an operation cannot change", () => {
  /**
   * A plugin that changes nothing.
   * @param name The plugin name.
   * @returns The plugin.
   */
  const plugin = (name: string): SchemaPlugin => ({ name, apply: () => undefined });

  /**
   * Defines a model and runs one operation on it, which seals its schema.
   * @returns The sealed entity class and its model.
   */
  const firstOperation = async () => {
    @Schema({ collection: "r9_sealed" })
    class Sealed extends Entity {
      @Prop(() => String, { required: true })
      name!: string;
    }
    const Sealeds = t.connection.model(Sealed);
    await Sealeds.countDocuments({ name: "a" });
    return { Sealed, Sealeds };
  };

  test("a late hook (decorator or builder): ConfigurationError; the compiled hook table is frozen", async () => {
    const { Sealed, Sealeds } = await firstOperation();
    const late = function (this: OperationHookContext<InstanceType<typeof Sealed>>): void {};
    expect(() => Pre("query.find")(Sealed.prototype, "late", { value: late })).toThrow(ConfigurationError);
    expect(() => Pre("query.find")(Sealed.prototype, "late", { value: late })).toThrow(
      /its schema is already compiled/,
    );
    expect(() => MetadataBuilder.for(Sealed).addHook("pre", "query.find", () => undefined)).toThrow(/already compiled/);
    const table = ModelInternals.schema(Sealeds).hooks["query.find"];
    expect(Object.isFrozen(ModelInternals.schema(Sealeds).hooks)).toBe(true);
    expect(Object.isFrozen(table) && Object.isFrozen(table.pre) && Object.isFrozen(table.post)).toBe(true);
    expect(table.pre.length).toBe(0);
  });

  test("a late plugin — model, connection or global level: ConfigurationError", async () => {
    const { Sealed } = await firstOperation();
    expect(() => Plugin(plugin("late-model"))(Sealed)).toThrow(/its schema is already compiled/);
    expect(() => t.connection.plugins.use(plugin("late-connection"))).toThrow(/fixed once a schema is compiled/);
    expect(() => Typemo.plugin(plugin("late-global"))).toThrow(/fixed once a schema is compiled/);
  });

  test("a late policy (tenant, soft delete, audit — @Schema or a plugin's enablePolicy): ConfigurationError", async () => {
    const { Sealed } = await firstOperation();
    /* Policies come from @Schema options or from a plugin (enablePolicy runs only while the schema compiles). */
    for (const options of [{ tenant: true }, { softDelete: true }, { audit: true }] as const) {
      expect(() => Schema({ collection: "r9_sealed", ...options })(Sealed)).toThrow(ConfigurationError);
    }
    const tenant: SchemaPlugin = { name: "late-tenant", apply: (builder) => builder.enablePolicy("tenant", true) };
    expect(() => Plugin(tenant)(Sealed)).toThrow(/its schema is already compiled/);
  });

  test("a late discriminator: ConfigurationError", async () => {
    const { Sealed } = await firstOperation();
    expect(() => {
      @Discriminator("late")
      class Late extends Sealed {
        declare readonly __t: DiscriminatorValue<"late">;
      }
      return Late;
    }).toThrow(/its schema is already compiled/);
  });
});

describe("a synchronous throw and an asynchronous rejection in any step end the same way", () => {
  const calls: string[] = [];

  /** An entity whose find hooks record every call. */
  @Schema({ collection: "r9_errors" })
  class Watched extends Entity {
    @Prop(() => String, { required: true })
    name!: string;

    @Pre("query.find")
    before(this: OperationHookContext<Watched, "query.find">): void {
      calls.push("pre");
    }

    @Post("query.find")
    after(this: OperationHookContext<Watched, "query.find">): void {
      calls.push("post");
    }

    @PostError("query.find")
    failed(this: OperationHookContext<Watched, "query.find">, error: unknown): void {
      calls.push(`postError ${(error as Error).message}`);
    }
  }

  let original: OperationPipeline | undefined;
  afterEach(() => {
    if (original !== undefined) ConnectionInternals.usePipeline(t.connection, original);
    original = undefined;
  });

  /**
   * The standard step of `slot`, with `run` replaced by one that fails — synchronously or with a rejected promise.
   * @param real The standard step.
   * @param error The error to fail with.
   * @param mode How the failure happens: a throw or a rejection.
   * @returns The failing step.
   */
  const failing = (real: OperationStep, error: Error, mode: "sync" | "async"): OperationStep => {
    const step: OperationStep = {
      name: real.name,
      /* No `needed`: the failing step runs for every schema (a step the model does not need would never fail). */
      run: (): void | Promise<void> => {
        if (mode === "sync") throw error;
        return Promise.reject(error);
      },
    };
    const onError = real.onError;
    return onError === undefined ? step : { ...step, onError: (ctx: OperationContext) => onError.call(real, ctx) };
  };

  /**
   * Runs a `find` with the step of `slot` failing in the given mode.
   * @param slot The pipeline slot to break.
   * @param mode How the step fails.
   * @returns What the caller saw and which hooks ran.
   */
  const outcome = async (slot: StepName, mode: "sync" | "async") => {
    original ??= ConnectionInternals.pipeline(t.connection);
    const error = new Error(`boom in ${slot}`);
    ConnectionInternals.usePipeline(t.connection, original.with({ [slot]: failing(original.step(slot), error, mode) }));
    calls.length = 0;
    let caught: unknown;
    try {
      await t.connection.model(Watched).find({ name: "a" });
    } catch (thrown) {
      caught = thrown;
    }
    return { same: caught === error, message: (caught as Error | undefined)?.message, calls: [...calls] };
  };

  for (const slot of STEP_ORDER) {
    test(`${slot}: the same postError calls and the same error`, async () => {
      const sync = await outcome(slot, "sync");
      const async = await outcome(slot, "async");
      expect(async).toEqual(sync);
      expect(sync.same).toBe(true);
      /*
       * Before hooksPost: exactly one postError with that error and no post. hooksPost itself and instrumentEnd (after
       * the post hooks; the standard step cannot fail — the hub catches its subscribers): no postError.
       */
      const postErrors = sync.calls.filter((line) => line.startsWith("postError"));
      const afterPost = slot === "hooksPost" || slot === "instrumentEnd";
      expect(postErrors).toEqual(afterPost ? [] : [`postError boom in ${slot}`]);
      expect(sync.calls.includes("post")).toBe(slot === "instrumentEnd");
    });
  }
});

describe("exactly one of post / postError per operation", () => {
  const calls: string[] = [];
  /** How the operation fails (set per case). */
  const plan: { preThrows: Error | undefined; modify: unknown; postThrows: Error | undefined } = {
    preThrows: undefined,
    modify: undefined,
    postThrows: undefined,
  };

  /** An entity whose find hooks record every call and can be told to fail. */
  @Schema({ collection: "r13_symmetry" })
  class Symmetric extends Entity {
    @Prop(() => String, { required: true })
    name!: string;

    @Pre("query.find")
    before(this: OperationHookContext<Symmetric, "query.find">): void {
      calls.push("pre");
      if (plan.preThrows !== undefined) throw plan.preThrows;
      /* cast: the cases give invalid changes on purpose (the preparation after it must fail) */
      if (plan.modify !== undefined) this.modify(plan.modify as never);
    }

    @Post("query.find")
    after(this: OperationHookContext<Symmetric, "query.find">): void {
      calls.push("post");
      if (plan.postThrows !== undefined) throw plan.postThrows;
    }

    @PostError("query.find")
    failed(this: OperationHookContext<Symmetric, "query.find">, error: unknown): void {
      calls.push(`postError ${(error as Error).name}`);
    }
  }

  let original: OperationPipeline | undefined;
  afterEach(() => {
    if (original !== undefined) ConnectionInternals.usePipeline(t.connection, original);
    original = undefined;
    plan.preThrows = undefined;
    plan.modify = undefined;
    plan.postThrows = undefined;
  });

  /**
   * Replaces the step of `slot` with one that throws `error` (its `onError` kept).
   * @param slot The pipeline slot to break.
   * @param error The error to throw.
   */
  const failIn = (slot: StepName, error: Error): void => {
    original ??= ConnectionInternals.pipeline(t.connection);
    const real = original.step(slot);
    const onError = real.onError;
    const step: OperationStep = {
      name: real.name,
      run: (): void => {
        throw error;
      },
      ...(onError === undefined ? {} : { onError: (ctx: OperationContext) => onError.call(real, ctx) }),
    };
    ConnectionInternals.usePipeline(t.connection, original.with({ [slot]: step }));
  };

  /**
   * Runs a `find` under the current plan.
   * @returns What the caller saw and which hooks ran.
   */
  const run = async (): Promise<{ readonly caught: unknown; readonly calls: readonly string[] }> => {
    calls.length = 0;
    const caught = await t.connection
      .model(Symmetric)
      .find({ name: "a" })
      .exec()
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    return { caught, calls: [...calls] };
  };

  test("success: post only", async () => {
    expect(await run()).toEqual({ caught: undefined, calls: ["pre", "post"] });
  });

  test("a pre hook throws: postError only, with the hook's error", async () => {
    const boom = new Error("pre");
    plan.preThrows = boom;
    const outcome = await run();
    expect(outcome.caught).toBe(boom);
    expect(outcome.calls).toEqual(["pre", "postError Error"]);
  });

  test("the preparation after a hook's modify fails: postError only", async () => {
    plan.modify = { where: { nope: 1 } };
    const outcome = await run();
    expect(outcome.caught).toBeInstanceOf(StrictModeError);
    expect(outcome.calls).toEqual(["pre", "postError StrictModeError"]);
  });

  test("execute fails: postError only", async () => {
    const boom = new Error("driver");
    failIn("execute", boom);
    const outcome = await run();
    expect(outcome.caught).toBe(boom);
    expect(outcome.calls).toEqual(["pre", "postError Error"]);
  });

  test("a post hook throws: its error reaches the caller as thrown; post only, no postError", async () => {
    const boom = new Error("post");
    plan.postThrows = boom;
    const outcome = await run();
    expect(outcome.caught).toBe(boom);
    expect(outcome.calls).toEqual(["pre", "post"]);
  });

  test("a step after the post hooks fails (instrumentEnd): post only, no postError", async () => {
    const boom = new Error("end");
    failIn("instrumentEnd", boom);
    const outcome = await run();
    expect(outcome.caught).toBe(boom);
    expect(outcome.calls).toEqual(["pre", "post"]);
  });
});

describe("a cursor whose post hooks ran for a batch — a later failure runs no postError", () => {
  const calls: string[] = [];

  /** An entity whose find post hook records every batch. */
  @Schema({ collection: "r20_cursor" })
  class Streamed extends Entity {
    @Prop(() => String, { required: true })
    name!: string;

    @Post("query.find")
    after(this: OperationHookContext<Streamed, "query.find">, rows: unknown): void {
      calls.push(`post ${(rows as readonly unknown[]).length}`);
    }

    @PostError("query.find")
    failed(this: OperationHookContext<Streamed, "query.find">, error: unknown): void {
      calls.push(`postError ${(error as Error).name}`);
    }
  }

  let original: OperationPipeline | undefined;
  let failpoint: FailPointHandle | undefined;
  afterEach(async () => {
    if (original !== undefined) ConnectionInternals.usePipeline(t.connection, original);
    original = undefined;
    await failpoint?.disable();
    failpoint = undefined;
  });

  /**
   * Five rows, read in batches of two: the second batch is the first `getMore`.
   * @returns What the caller saw and the names that were read.
   */
  const read = async (): Promise<{ readonly caught: unknown; readonly names: readonly string[] }> => {
    const Streams = t.connection.model(Streamed);
    const raw = t.mongo.db.collection("r20_cursor");
    await raw.deleteMany({});
    await raw.insertMany(["a", "b", "c", "d", "e"].map((name) => ({ name })));
    calls.length = 0;
    const names: string[] = [];
    try {
      for await (const doc of Streams.find().sort({ name: 1 }).batchSize(2).lean().cursor()) names.push(doc.name);
    } catch (error) {
      return { caught: error, names };
    }
    return { caught: undefined, names };
  };

  test("the driver's getMore fails on the second batch: post once (batch 1), no postError, the error to the caller", async () => {
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["getMore"],
      errorCode: 2,
      times: 1,
    });
    const outcome = await read();
    expect(outcome.names).toEqual(["a", "b"]);
    expect(outcome.caught).toBeInstanceOf(ServerError);
    expect((outcome.caught as ServerError).code).toBe(2);
    expect(calls).toEqual(["post 2"]);
  });

  test("postProcess fails on the second batch: post once, no postError, the error as thrown", async () => {
    original ??= ConnectionInternals.pipeline(t.connection);
    const real = original.step("postProcess");
    const boom = new Error("second batch");
    let batches = 0;
    const step: OperationStep = {
      name: real.name,
      run: (ctx: OperationContext) => {
        batches += 1;
        if (batches === 2) throw boom;
        return real.run(ctx);
      },
    };
    ConnectionInternals.usePipeline(t.connection, original.with({ postProcess: step }));
    const outcome = await read();
    expect(outcome.names).toEqual(["a", "b"]);
    expect(outcome.caught).toBe(boom);
    expect(calls).toEqual(["post 2"]);
  });

  test("the first batch fails (no post yet): postError once", async () => {
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["find"],
      errorCode: 2,
      times: 1,
    });
    const outcome = await read();
    expect(outcome.names).toEqual([]);
    expect(outcome.caught).toBeInstanceOf(ServerError);
    expect(calls).toEqual(["postError ServerError"]);
  });
});
