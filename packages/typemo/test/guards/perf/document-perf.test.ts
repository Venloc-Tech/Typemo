/*
 * Perf guard for documents and populate. Lightweight and not flaky by design: every hot path is timed against a
 * LEAN baseline measured in the same process, on the same data, right before it, and the thresholds are generous
 * (well above the measured ratio, below the ratio of the slow implementation). A failure means a hot path got
 * much slower, not a noisy run. The pipeline's guard is `pipeline-perf.test.ts`.
 *
 * Ratios (median of 15 runs, MongoDB 8.3 in Docker, 1000 documents), slow implementation → current:
 * - `find()` hydrated ÷ `find().lean()` of the medium shape: 2.6–2.8 → 1.2 (guard: < 2.0);
 * - `$toObject()` of 1000 documents ÷ the lean read: 0.32–0.35 → 0.10–0.11 (guard: < 0.25);
 * - `populate("writer")` hydrated ÷ lean (100 distinct writers): 1.33–1.37 → 0.98–1.11 (guard: < 1.5: a populate
 *   ratio this close to 1 needs room).
 * Measured with the MongoDB 9.0 memory-server on one machine (`bun run test:perf`):
 * - `find().plain()` ÷ `find().lean()` of the medium shape: 1.08–1.09 (guard: < 1.6);
 * - `$toPlain()` of 1000 documents ÷ the lean read: 0.10–0.13 (guard: < 0.3).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import type { Model } from "../../../src/index.ts";
import { PerfArticle, PerfMedium, PerfWriter, perfMediumRaw } from "../../fixtures/document/perf-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("perf_a_guard");
const COUNT = 1000;
const WRITERS = 100;

let Mediums: Model<PerfMedium>;
let Articles: Model<PerfArticle>;

/** Median wall time of `runs` calls after `warm` untimed ones (ms). */
const median = async (fn: () => Promise<unknown> | unknown, runs = 15, warm = 5): Promise<number> => {
  for (let i = 0; i < warm; i++) await fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] as number;
};

/** `bun run test:perf` prints what it measured (a pass says only "under the threshold"). */
const report = (what: string, ratio: number): void => {
  console.info(`[perf] ${what}: ${ratio.toFixed(2)}`);
};

/* The test database is emptied after every test (`MongoLifecycle`): each test gets the data again. */
beforeEach(async () => {
  Mediums = t.connection.model(PerfMedium);
  Articles = t.connection.model(PerfArticle);
  t.connection.model(PerfWriter);
  await t.mongo.db
    .collection("perf_medium")
    .insertMany(Array.from({ length: COUNT }, (_, i) => perfMediumRaw(i, new ObjectId())));
  const writers = Array.from({ length: WRITERS }, (_, i) => ({ _id: new ObjectId(), name: `w${i}`, country: "FR" }));
  await t.mongo.db.collection("perf_writers").insertMany(writers);
  await t.mongo.db.collection("perf_articles").insertMany(
    Array.from({ length: COUNT }, (_, i) => ({
      _id: new ObjectId(),
      title: `article ${i}`,
      writer: writers[i % WRITERS]?._id,
    })),
  );
});

describe("perf guard: documents (relative to lean in the same process)", () => {
  test("hydrate 1000 medium documents", async () => {
    const lean = await median(() => Mediums.find({}).lean());
    const hydrated = await median(() => Mediums.find({}));
    const docs = await Mediums.find({});
    expect(docs.length).toBe(COUNT);
    report("hydrate 1000 medium ÷ lean", hydrated / lean);
    expect(hydrated / lean).toBeLessThan(2.0);
  }, 60_000);

  test("$toObject of 1000 medium documents", async () => {
    const docs = await Mediums.find({});
    const lean = await median(() => Mediums.find({}).lean());
    const plain = await median(() => docs.map((doc) => doc.$toObject()));
    expect(docs[0]?.$toObject()).toMatchObject({ title: "title 0 lorem ipsum dolor", author: { first: "first0" } });
    report("$toObject 1000 ÷ lean find", plain / lean);
    expect(plain / lean).toBeLessThan(0.25);
  }, 60_000);

  /* `.plain()` reads the lean rows and converts them by the schema (no hydration) — close to lean. */
  test(".plain() of 1000 medium documents", async () => {
    const lean = await median(() => Mediums.find({}).lean());
    const plain = await median(() => Mediums.find({}).plain());
    const rows = await Mediums.find({}).plain();
    expect(rows.length).toBe(COUNT);
    expect(typeof rows[0]?._id).toBe("string");
    report(".plain() 1000 medium ÷ lean", plain / lean);
    expect(plain / lean).toBeLessThan(1.6);
  }, 60_000);

  test("$toPlain of 1000 medium documents", async () => {
    const docs = await Mediums.find({});
    const lean = await median(() => Mediums.find({}).lean());
    const plain = await median(() => docs.map((doc) => doc.$toPlain()));
    expect(docs[0]?.$toPlain()).toMatchObject({ title: "title 0 lorem ipsum dolor", author: { first: "first0" } });
    report("$toPlain 1000 ÷ lean find", plain / lean);
    expect(plain / lean).toBeLessThan(0.3);
  }, 60_000);

  test("populate a single ref of 1000 documents", async () => {
    const lean = await median(() => Articles.find({}).populate("writer").lean());
    const hydrated = await median(() => Articles.find({}).populate("writer"));
    const docs = await Articles.find({}).populate("writer");
    expect(docs.length).toBe(COUNT);
    expect(docs[0]?.writer).toMatchObject({ name: "w0" });
    report("populate hydrated ÷ lean", hydrated / lean);
    expect(hydrated / lean).toBeLessThan(1.5);
  }, 60_000);
});
