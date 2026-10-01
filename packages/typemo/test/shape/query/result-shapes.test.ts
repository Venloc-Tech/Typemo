import { beforeEach, describe, expect, test } from "bun:test";
import { expectShapeMatches, MongoLifecycle, ShapeCompare } from "@venloc/typemo-test-kit";
import { BsonOptions } from "../../../src/index.ts";
import { models, seed } from "../../fixtures/query/seed.ts";
import { type ShapeQueries, shapeQueries } from "../../fixtures/query/shape-queries.ts";

/*
 * The result type the compiler computes for a query (the automaton of types/result.ts) is compared with the
 * shape of what the server returns for the same query, run through the test plan runner (no hydration: lean
 * results only).
 */

const mongo = MongoLifecycle.useMongo("query_shape", BsonOptions.apply({}));
const queries = shapeQueries(models(() => mongo.db));
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;

beforeEach(async () => {
  await seed(mongo.db);
});

/** The probe source: the awaited result type of the query `name`, or of its first element. */
const source = (name: keyof ShapeQueries, element = false): string => `
import type { ShapeQueries } from "./query/shape-queries.ts";
type Result = Awaited<ReturnType<ShapeQueries["${name}"]>>;
export type Shape = ${element ? "NonNullable<Result>[number]" : "NonNullable<Result>"};
`;

/** The shape-harness target for the query `name`. */
const target = (name: keyof ShapeQueries, element = false) => ({
  code: source(name, element),
  type: "Shape",
  dir: FIXTURES,
});

describe("shape: query result type vs the server's document", () => {
  /*
   * One row per query: the probe reads the type by name, the thunk runs the same query (a thunk per row: indexing
   * `queries[name]` with a union of names would build the union of every result type).
   */
  const rows: readonly (readonly [keyof ShapeQueries, string, () => PromiseLike<unknown>])[] = [
    [
      "leanDefault",
      "the default view: Hidden out (top and nested), markers gone, Map → record, bigint, Decimal128",
      () => queries.leanDefault(),
    ],
    ["leanMinimal", "optional fields absent, defaulted present", () => queries.leanMinimal()],
    ["plusHidden", "+passwordHash adds the Hidden field", () => queries.plusHidden()],
    ["inclusion", "inclusion without _id", () => queries.inclusion()],
    ["dotted", "dotted inclusion builds the nested object", () => queries.dotted()],
    ["exclusion", "exclusion", () => queries.exclusion()],
    ["idOnly", "{ _id: 1 } alone is only _id", () => queries.idOnly()],
    ["article", "embedded discriminated union (G4), nullable date", () => queries.article()],
    ["populateRef", "a populated single ref", () => queries.populateRef()],
    ["populateArray", "a populated ref array with select", () => queries.populateArray()],
    ["populateVirtual", "a populated virtual", () => queries.populateVirtual()],
    ["modified", "findOneAndUpdate after the update (D31)", () => queries.modified()],
    ["maskedLean", 'lean().mask(): "mask" → "?", a function → its result (R39)', () => queries.maskedLean()],
    ["maskedPopulate", "a populated path masked (R39)", () => queries.maskedPopulate()],
  ];

  for (const [name, what, run] of rows) {
    test(`${name}: ${what}`, async () => {
      expectShapeMatches(target(name), await run());
    });
  }

  test("narrowed list and textScore (element of the array)", async () => {
    expectShapeMatches(target("narrowed", true), (await queries.narrowed())[0]);
    await mongo.db.collection("q_articles").createIndex({ title: "text" });
    expectShapeMatches(target("textScore", true), (await queries.textScore())[0]);
  });

  test("values and write results", async () => {
    expectShapeMatches(target("exists"), await queries.exists());
    expectShapeMatches(target("distinctTags", true), (await queries.distinctTags())[0]);
    expectShapeMatches({ code: source("count"), type: "Shape", dir: FIXTURES }, await queries.count());
    expectShapeMatches(target("updated"), await queries.updated());
    expectShapeMatches(target("deleted"), await queries.deleted());
    expectShapeMatches(target("metadata"), await queries.metadata());
  });

  test("negative: the default view never contains passwordHash, and a document with it does not match", async () => {
    const withHidden = await mongo.db.collection("q_members").findOne({ name: "Ann" });
    const check = ShapeCompare.check(target("leanDefault"), withHidden);
    expect(check.ok).toBe(false);
    expect(check.mismatches.map((mismatch) => mismatch.path)).toContain("$.passwordHash");
  });
});
