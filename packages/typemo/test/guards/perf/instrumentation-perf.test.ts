/*
 * The cost of instrumentation.
 * 1. Strict, structural: without a subscriber the instrumentation paths (wrap, tenant, lazy summary, steps) do
 *    NOTHING — not one call of `around`, of the event builders or of the redactor.
 * 2. Timing, generous and relative (same process, interleaved): a no-op subscriber (the way an adapter
 *    registers: `steps: false`, a pass-through `wrap`) against no subscriber; the raw driver as reference.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { ObjectId } from "mongodb";
import type { Model, Subscription } from "../../../src/index.ts";
import { InstrumentationHub } from "../../../src/instrumentation/instrumentation-hub.ts";
import { OperationEvents } from "../../../src/operation/pipeline/steps/operation-events.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { PerfPlain } from "../../fixtures/perf/pipeline-perf-entities.ts";

const t = ModelLifecycle.useTypemo("perf_i", { monitorCommands: false });
let Plain: Model<PerfPlain>;
let subscription: Subscription | undefined;

/** The median of `values`. */
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

beforeEach(async () => {
  Plain = t.connection.model(PerfPlain);
  await t.mongo.db
    .collection("perf_plain")
    .insertMany(Array.from({ length: 50 }, (_, n) => ({ name: `p${n}`, n, tags: ["a"] })));
});

afterEach(() => {
  subscription?.unsubscribe();
  subscription = undefined;
});

describe("no subscriber: the instrumentation paths do nothing", () => {
  test("no around, no event builder, no tenant, no redaction", async () => {
    const spies = [
      spyOn(InstrumentationHub.prototype, "around"),
      spyOn(InstrumentationHub.prototype, "emit"),
      spyOn(OperationEvents, "info"),
      spyOn(OperationEvents, "tenant"),
      spyOn(OperationEvents, "start"),
      spyOn(OperationEvents, "summary"),
    ];
    try {
      await Plain.find({ n: { $gte: 1 } }).lean();
      await Plain.updateOne({ n: 1 }, { $set: { name: "x" } });
      for await (const _ of Plain.find().cursor()) break;
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("timing (generous thresholds)", () => {
  test("findOne lean by _id: a no-op adapter-like subscriber costs at most 1.5× + 0.3 ms over none", async () => {
    const raw = t.mongo.db.collection("perf_plain");
    const id = (await raw.findOne({ n: 7 }))?._id as ObjectId;
    const one = () => Plain.findOne({ _id: id }).lean().exec();
    const times = { none: [] as number[], noop: [] as number[], driver: [] as number[] };
    const noop = () => t.client.instrument({ handle: () => {}, steps: false, wrap: (_operation, run) => run() });
    for (let index = 0; index < 205; index++) {
      let started = performance.now();
      await one();
      if (index >= 5) times.none.push(performance.now() - started);
      subscription = noop();
      started = performance.now();
      await one();
      if (index >= 5) times.noop.push(performance.now() - started);
      subscription.unsubscribe();
      subscription = undefined;
      started = performance.now();
      await raw.findOne({ _id: id });
      if (index >= 5) times.driver.push(performance.now() - started);
    }
    const none = median(times.none);
    const withNoop = median(times.noop);
    const driver = median(times.driver);
    console.info(
      `[perf] findOne lean by _id: no subscriber ${none.toFixed(3)} ms, no-op subscriber (wrap, steps:false) ${withNoop.toFixed(3)} ms, driver ${driver.toFixed(3)} ms`,
    );
    expect(withNoop).toBeLessThanOrEqual(none * 1.5 + 0.3);
    expect(none).toBeLessThanOrEqual(driver * 1.5 + 0.25);
  });
});
