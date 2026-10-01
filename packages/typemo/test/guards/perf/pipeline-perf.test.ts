/*
 * The perf guard of the operation pipeline.
 * 1. Aggregation rows: a model stored as in code gets the DRIVER's rows (same objects, never copied, never
 *    changed by the steps after `execute`); a model with `dbName` gets new translated rows and the driver's rows
 *    stay untouched.
 * 2. No instrumentation subscriber: not one event object is built (reads, cursor, aggregation, writes, an error,
 *    a transaction).
 * 3. Timing, generous and relative to the raw driver in the same process (not flaky by design): aggregation
 *    row processing and the pipeline overhead of a small operation. They catch an order-of-magnitude
 *    regression (a per-row copy, a per-operation schema walk), not a few percent.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { BSON, ObjectId } from "mongodb";
import { InstrumentationHub } from "../../../src/instrumentation/instrumentation-hub.ts";
import { ConnectionInternals, type Model } from "../../../src/internal.ts";
import type { OperationContext } from "../../../src/operation/pipeline/operation-context.ts";
import type { OperationPipeline } from "../../../src/operation/pipeline/operation-pipeline.ts";
import type { OperationStep } from "../../../src/operation/pipeline/operation-step.ts";
import { OperationEvents } from "../../../src/operation/pipeline/steps/operation-events.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { PerfAliased, PerfPlain } from "../../fixtures/perf/pipeline-perf-entities.ts";

/* No command monitoring on the Typemo client: the timing compares the pipeline with the bare driver. */
const t = ModelLifecycle.useTypemo("perf_b", { monitorCommands: false });
let Plain: Model<PerfPlain>;
let Aliased: Model<PerfAliased>;
let original: OperationPipeline;

/** Wraps the `execute` slot: keeps the driver's rows and a deep copy of them taken right after the call. */
class RowCapture implements OperationStep {
  readonly name = "execute";
  rows: unknown[] | undefined;
  copy: unknown[] | undefined;

  constructor(private readonly inner: OperationStep) {}

  async run(ctx: OperationContext): Promise<void> {
    await this.inner.run(ctx);
    if (!Array.isArray(ctx.result)) return;
    this.rows = ctx.result;
    this.copy = (BSON.deserialize(BSON.serialize({ rows: ctx.result })) as { rows: unknown[] }).rows;
  }

  onError(ctx: OperationContext): void | Promise<void> {
    return this.inner.onError?.(ctx);
  }
}

/** Installs a `RowCapture` in place of the connection's `execute` step and returns it. */
const capture = (): RowCapture => {
  const step = new RowCapture(original.step("execute"));
  ConnectionInternals.usePipeline(t.connection, original.with({ execute: step }));
  return step;
};

/** The median of `values`. */
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

/** Median wall time of `a` and `b`, interleaved (same server, same moment). */
const race = async (runs: number, a: () => Promise<unknown>, b: () => Promise<unknown>) => {
  const times: [number[], number[]] = [[], []];
  for (let index = 0; index < runs + 5; index++) {
    for (const [slot, fn] of [a, b].entries()) {
      const started = performance.now();
      await fn();
      if (index >= 5) times[slot as 0 | 1].push(performance.now() - started);
    }
  }
  return { a: median(times[0]), b: median(times[1]) };
};

beforeEach(async () => {
  original = ConnectionInternals.pipeline(t.connection);
  Plain = t.connection.model(PerfPlain);
  Aliased = t.connection.model(PerfAliased);
  await t.mongo.db
    .collection("perf_plain")
    .insertMany(Array.from({ length: 500 }, (_, n) => ({ name: `p${n}`, n, tags: ["a", "b"] })));
  await t.mongo.db
    .collection("perf_aliased")
    .insertMany(Array.from({ length: 50 }, (_, n) => ({ nm: `a${n}`, n, ln: [{ s: `s${n}`, qty: n }] })));
});

afterEach(() => {
  ConnectionInternals.usePipeline(t.connection, original);
});

describe("aggregation rows", () => {
  test("a model stored as in code: the rows ARE the driver's rows, unchanged after every step", async () => {
    const step = capture();
    const rows = await Plain.aggregate((p) => p.match({ n: { $gte: 0 } }).sort({ n: 1 }));
    expect(rows).toHaveLength(500);
    expect(step.rows).toHaveLength(500);
    /* Same objects: no per-row copy… */
    rows.forEach((row, index) => {
      expect(row).toBe(step.rows?.[index] as never);
    });
    /* …and nothing after `execute` changed them. */
    expect(step.rows).toEqual(step.copy as unknown[]);
    expect(rows[0]).toEqual({ _id: expect.any(ObjectId), name: "p0", n: 0, tags: ["a", "b"] });
  });

  test("a cursor over the same model streams the driver's rows too", async () => {
    const names: string[] = [];
    for await (const row of Plain.aggregate((p) => p.match({ n: { $lt: 3 } }).sort({ n: 1 }))
      .batchSize(2)
      .cursor()) {
      names.push(row.name);
    }
    expect(names).toEqual(["p0", "p1", "p2"]);
  });

  test("a model with dbName: new rows in code names (subdocument arrays too); the driver's rows untouched", async () => {
    const step = capture();
    const rows = await Aliased.aggregate((p) => p.match({ n: { $lt: 2 } }).sort({ n: 1 }));
    expect(rows).toEqual([
      { _id: expect.any(ObjectId), name: "a0", n: 0, lines: [{ sku: "s0", qty: 0 }] },
      { _id: expect.any(ObjectId), name: "a1", n: 1, lines: [{ sku: "s1", qty: 1 }] },
    ]);
    rows.forEach((row, index) => {
      expect(row).not.toBe(step.rows?.[index] as never);
    });
    expect(step.rows).toEqual(step.copy as unknown[]);
    expect(step.rows?.[0]).toMatchObject({ nm: "a0", ln: [{ s: "s0" }] });
  });
});

describe("no subscriber, no event object", () => {
  test("reads, a cursor, an aggregation, writes, an error and a transaction build no event", async () => {
    const spies = [
      spyOn(OperationEvents, "info"),
      spyOn(OperationEvents, "start"),
      spyOn(OperationEvents, "summary"),
      spyOn(OperationEvents, "error"),
      spyOn(InstrumentationHub.prototype, "emit"),
    ];
    try {
      expect(t.client.instrumentation.enabled).toBe(false);
      const first = await Plain.findOne({ n: 1 }).lean();
      await Plain.find({ n: { $lt: 5 } });
      for await (const _ of Plain.find({ n: { $lt: 5 } })
        .batchSize(2)
        .cursor()) {
        /* iterate every batch */
      }
      await Plain.aggregate((p) => p.match({ n: { $lt: 5 } }));
      await Plain.insertMany([{ name: "x", n: 1000, tags: [] }]);
      await Plain.updateOne({ n: 1000 }, { $set: { name: "y" } });
      await Plain.deleteOne({ n: 1000 });
      const failed = await Plain.insertMany([{ _id: first?._id as ObjectId, name: "dup", n: 1, tags: [] }]).catch(
        (error: unknown) => error,
      );
      expect(failed).toBeInstanceOf(Error);
      await t.connection.transaction(async () => {
        await Plain.updateOne({ n: 2 }, { $set: { name: "p2" } });
      });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      /* The spies do see events once someone listens (the check above is not vacuous). */
      const subscription = t.client.instrument({ handle: () => undefined });
      try {
        await Plain.findOne({ n: 1 }).lean();
      } finally {
        subscription.unsubscribe();
      }
      expect(spies[1]).toHaveBeenCalled();
      expect(spies[4]).toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("timing against the raw driver (generous thresholds)", () => {
  test("aggregation of 500 rows: at most 1.5× the driver + 2 ms", async () => {
    const raw = t.mongo.db.collection("perf_plain");
    const { a: typemo, b: driver } = await race(
      15,
      () => Plain.aggregate((p) => p.match({ n: { $gte: 0 } })).exec(),
      () => raw.aggregate([{ $match: { n: { $gte: 0 } } }]).toArray(),
    );
    console.info(`[perf] aggregate 500 rows: typemo ${typemo.toFixed(3)} ms, driver ${driver.toFixed(3)} ms`);
    expect(typemo).toBeLessThanOrEqual(driver * 1.5 + 2);
  });

  test("findOne by _id (lean): at most 1.5× the driver + 0.25 ms", async () => {
    const raw = t.mongo.db.collection("perf_plain");
    const doc = await raw.findOne({ n: 7 });
    const id = doc?._id as ObjectId;
    const { a: typemo, b: driver } = await race(
      200,
      () => Plain.findOne({ _id: id }).lean().exec(),
      () => raw.findOne({ _id: id }),
    );
    console.info(`[perf] findOne lean by _id: typemo ${typemo.toFixed(3)} ms, driver ${driver.toFixed(3)} ms`);
    expect(typemo).toBeLessThanOrEqual(driver * 1.5 + 0.25);
  });
});
