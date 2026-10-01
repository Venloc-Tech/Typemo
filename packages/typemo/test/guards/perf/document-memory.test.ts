/*
 * A cursor does not keep the documents it streamed. Once the finished source generator stayed reachable from the
 * cursor (`CursorStream.#iterator`) and its frame held the LAST batch — 1000 hydrated documents, ≈ 14 MB after
 * streaming 100k medium documents in the bench (Mongoose ≈ 3 MB). Two checks, both independent of the machine's
 * speed:
 * - every document of the last batch is collectable once the loop is over (weak references; JSC scans the stack
 *   conservatively, so a couple may survive a collection by chance);
 * - the heap retained after streaming all documents stays within a bound, and hydrated documents retain no more
 *   than lean ones (≈ 2.7 MB is retained either way here — driver and runtime state, not documents; one retained
 *   batch of 2000 hydrated medium documents adds ≈ 5 MB).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import type { Model } from "../../../src/index.ts";
import { PerfMedium, perfMediumRaw } from "../../fixtures/document/perf-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("perf_a_memory");
const COUNT = 6000;
const BATCH = 2000;
/** Retained heap allowed after streaming everything. */
const RETAINED_LIMIT = 5 * 1024 * 1024;
/** How much more the hydrated stream may retain than the lean one. */
const HYDRATED_EXTRA = 1.5 * 1024 * 1024;

let Mediums: Model<PerfMedium>;

beforeEach(async () => {
  Mediums = t.connection.model(PerfMedium);
  const docs = Array.from({ length: COUNT }, (_, i) => perfMediumRaw(i, new ObjectId()));
  for (let start = 0; start < COUNT; start += 2000) {
    await t.mongo.db.collection("perf_medium").insertMany(docs.slice(start, start + 2000));
  }
});

/** Lets pending promise jobs (the cursor's close) settle, then collects twice. */
const collect = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  Bun.gc(true);
  Bun.gc(true);
};

/** Streams every document; keeps weak references to the documents of the last batch. */
const stream = async (lean: boolean, refs: WeakRef<object>[]): Promise<number> => {
  let count = 0;
  const query = Mediums.find({}).sort({ _id: 1 }).batchSize(BATCH);
  const cursor = lean ? query.lean().cursor() : query.cursor();
  for await (const doc of cursor) {
    count++;
    if (count > COUNT - BATCH) refs.push(new WeakRef(doc));
  }
  return count;
};

/** Streams twice (the first pass pays the one-time costs); the heap retained by the second, and its live refs. */
const measure = async (lean: boolean): Promise<{ readonly retained: number; readonly alive: number }> => {
  await stream(lean, []);
  await collect();
  const before = process.memoryUsage().heapUsed;
  const refs: WeakRef<object>[] = [];
  expect(await stream(lean, refs)).toBe(COUNT);
  await collect();
  const retained = process.memoryUsage().heapUsed - before;
  expect(refs.length).toBe(BATCH);
  return { retained, alive: refs.filter((ref) => ref.deref() !== undefined).length };
};

describe("a cursor keeps nothing it streamed", () => {
  test("the last batch is collectable; the retained heap is bounded and no larger than lean's", async () => {
    const lean = await measure(true);
    const hydrated = await measure(false);
    expect(lean.alive).toBeLessThanOrEqual(3);
    expect(hydrated.alive).toBeLessThanOrEqual(3);
    expect(lean.retained).toBeLessThan(RETAINED_LIMIT);
    expect(hydrated.retained).toBeLessThan(RETAINED_LIMIT);
    expect(hydrated.retained - lean.retained).toBeLessThan(HYDRATED_EXTRA);
  }, 60_000);
});
