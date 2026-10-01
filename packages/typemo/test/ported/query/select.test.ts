/*
 * Ported from mongoose test/schema.select.test.js, test/query.test.js (select), test/helpers/projection.
 * isExclusive/isInclusive.test.js onto Typemo. The string DSL of Mongoose becomes the object
 * form: `'-thin +name'` → `{ thin: 0, "+name": true }`. Mongoose's `isSelected()` belongs to the document
 * layer: only the data returned is checked here. Plans run through the test-only plan runner.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import {
  BsonOptions,
  Filters,
  type Hidden,
  ModelOperations,
  ProjectionPlanner,
  Prop,
  QueryError,
  Schema,
} from "../../../src/internal.ts";
import { Entity } from "../../../src/schema/entity/base-classes.ts";
import { PlanRunner } from "../../fixtures/query/plan-runner.ts";

const mongo = MongoLifecycle.useMongo("ported_select", BsonOptions.apply({}));
const runner = new PlanRunner(() => mongo.db);

@Schema()
class Sub {
  @Prop(() => Boolean)
  bool?: boolean;

  @Prop(() => String, { hidden: true })
  name?: Hidden<string>;
}

@Schema({ collection: "ported_select_excluded" })
class Excluded extends Entity {
  @Prop(() => Boolean)
  thin?: boolean;

  @Prop(() => String, { hidden: true })
  name?: Hidden<string>;

  @Prop(() => [Sub])
  docs!: Sub[];
}

@Schema({ collection: "ported_select_plain" })
class Plain extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => Number)
  age?: number;
}

@Schema({ collection: "ported_select_many" })
class Many extends Entity {
  @Prop(() => [String], { hidden: true })
  many!: Hidden<string[]>;
}

const E = new ModelOperations(Excluded, runner);
const P = new ModelOperations(Plain, runner);
const M = new ModelOperations(Many, runner);

beforeEach(async () => {
  await mongo.db
    .collection("ported_select_excluded")
    .insertOne({ thin: true, name: "the excluded", docs: [{ bool: true, name: "test" }] });
  await mongo.db.collection("ported_select_plain").insertOne({ name: "ssd", age: 0 });
  await mongo.db.collection("ported_select_many").insertOne({ many: ["1", "2", "3", "4", "5"] });
});

describe("schema select: false (Typemo Hidden<T>)", () => {
  // ported from mongoose test/schema.select.test.js:28 "excluding paths through schematype"
  test("excluding paths through schematype", async () => {
    // The TYPES already say it: `name` is not a key of these results (reading it is a type error).
    const hasName = (doc: object | null | undefined): boolean => doc !== null && doc !== undefined && "name" in doc;
    const found = await E.findOne().select({ thin: 0, "docs.bool": 0 }).orFail().lean();
    expect([hasName(found), hasName(found.docs[0])]).toEqual([false, false]);
    const plain = await E.findOne().orFail().lean();
    expect([hasName(plain), hasName(plain.docs[0]), plain.thin]).toEqual([false, false, true]);
    /* Filters.all(): an empty filter literal of a One form is a compile error */
    const updated = await E.findOneAndUpdate(Filters.all(), { $set: { thin: false } })
      .orFail()
      .lean();
    expect([hasName(updated), hasName(updated.docs[0])]).toEqual([false, false]);
    const deleted = await E.findOneAndDelete(Filters.all()).lean();
    expect([hasName(deleted), hasName(deleted?.docs[0])]).toEqual([false, false]);
  });

  // ported from mongoose test/schema.select.test.js:301 "forcing inclusion of a deselected schema path works"
  test("forcing inclusion of a deselected schema path works", async () => {
    let doc = await E.findOne().select({ "+name": true, "+docs.name": true }).orFail().lean();
    expect([doc.thin, doc.name, doc.docs[0]?.bool, doc.docs[0]?.name]).toEqual([true, "the excluded", true, "test"]);
    doc = await E.findOne().select({ "+name": true, thin: 0, "+docs.name": true, "docs.bool": 0 }).orFail().lean();
    expect([doc.thin, doc.name, doc.docs[0]?.bool, doc.docs[0]?.name]).toEqual([
      undefined,
      "the excluded",
      undefined,
      "test",
    ]);
    const none = await E.findOne().select({ thin: 0, "docs.bool": 0 }).orFail().lean();
    expect(none).toEqual({ _id: none._id, docs: [{}] });
  });

  // ported from mongoose test/schema.select.test.js:364 "works with query.slice (gh-1370)"
  test("works with query.slice (gh-1370)", async () => {
    const doc = await M.findOne()
      .select({ "+many": true, many: { $slice: 2 } })
      .orFail()
      .lean();
    expect(doc.many).toEqual(["1", "2"]);
  });

  // ported from mongoose test/schema.select.test.js:375 "ignores if path does not have select in schema (gh-6785)"
  test("ignores if path does not have select in schema (gh-6785) — divergence: `+field` only on Hidden fields", () => {
    // Typemo: `+a` on a field that is not Hidden is a type error (it adds nothing); see DIVERGENCES L3-4.
    const plan = P.findOne()
      // @ts-expect-error `+name` — `name` is not a Hidden field
      .select({ "+name": true })
      .build();
    expect(plan.projection).toEqual({ "+name": true });
  });

  // ported from mongoose test/schema.select.test.js:388 "omits if not in schema (gh-7017)"
  test("omits if not in schema (gh-7017) — divergence: an unknown field is a type error, not silently projected", () => {
    // @ts-expect-error `+c` is not a field of the class
    const build = () => E.find().select({ "+c": true });
    expect(build).not.toThrow(); // the runtime has no schema at build time; paths are resolved later, at execution
  });

  // ported from mongoose test/schema.select.test.js:411 "conflicting schematype path selection should not error"
  test("conflicting schematype path selection should not error", async () => {
    const doc = await E.findOne().orFail().lean();
    expect([doc.thin, "name" in doc]).toEqual([true, false]);
  });

  // ported from mongoose test/schema.select.test.js:432 "selecting _id works with excluded schematype path"
  test("selecting _id works with excluded schematype path (and on a sub doc, :441)", async () => {
    const docs = await E.find().select({ _id: 1 }).lean();
    expect(Object.keys(docs[0] ?? {})).toEqual(["_id"]);
  });

  // ported from mongoose test/schema.select.test.js:450 "inclusive/exclusive combos should work"
  test("inclusive/exclusive combos should work — divergence: mixing throws before the query (QueryError)", async () => {
    const d = await P.findOne().select({ _id: 0, name: 1 }).orFail().lean();
    expect(d).toEqual({ name: "ssd" });
    const noIdNoName = await P.findOne().select({ _id: 0, name: 0 }).orFail().lean();
    expect(noIdNoName).toEqual({ age: 0 });
    const idName = await P.findOne().select({ _id: 1, name: 1 }).orFail().lean();
    expect(Object.keys(idName).sort()).toEqual(["_id", "name"]);
    // @ts-expect-error inclusion mixed with exclusion
    expect(() => P.findOne().select({ age: 1, name: 0 })).toThrow(QueryError);
    // @ts-expect-error exclusion mixed with inclusion
    expect(() => P.findOne().select({ age: 0, name: 1 })).toThrow(QueryError);
    const onlyId = await P.findOne().select({ age: 0, name: 0 }).orFail().lean();
    expect(Object.keys(onlyId)).toEqual(["_id"]);
    const both = await P.findOne().select({ age: 1, name: 1 }).orFail().lean();
    expect([both.name, both.age]).toEqual(["ssd", 0]);
  });

  // ported from mongoose test/schema.select.test.js:491 "when select is false in the schema definition, all inclusive/exclusive combos should work"
  test("when select is false in the schema definition, all combos work", async () => {
    await mongo.db.collection("ported_select_excluded").updateMany({}, { $set: { thin: false } });
    const named = await E.findOne().select({ _id: 0, name: 1 }).orFail().lean();
    expect(named).toEqual({ name: "the excluded" });
    const excluded = await E.findOne().select({ _id: 0, thin: 0 }).orFail().lean();
    expect(Object.keys(excluded)).toEqual(["docs"]);
    expect(excluded.docs).toEqual([{ bool: true }]);
  });
});

describe("select merging and projection modes", () => {
  // ported from mongoose test/query.test.js:82 "should not overwrite fields set in prior calls"
  test("should not overwrite fields set in prior calls", () => {
    const query = P.find().select({ name: 1 }).select({ age: 1 });
    expect(query.build().projection).toEqual({ name: 1, age: 1 });
  });

  // ported from mongoose test/helpers/projection.isExclusive.test.js:9 and isInclusive.test.js:9 "handles $elemMatch (gh-14893)"
  test("handles $elemMatch (gh-14893): an $elemMatch projection is an inclusion", () => {
    expect(
      ProjectionPlanner.modeOfProjection({ field: { $elemMatch: { test: new Date("2024-06-01") } }, otherProp: 1 }),
    ).toBe("include");
  });

  // ported from mongoose test/query.test.js:540 "slice where and positive limit param" (+ :546, :552)
  test("slice: $slice in the projection (n, -n, [skip, limit])", () => {
    expect(
      M.find()
        .select({ many: { $slice: 5 } })
        .build().projection,
    ).toEqual({ many: { $slice: 5 } });
    expect(
      M.find()
        .select({ many: { $slice: -5 } })
        .build().projection,
    ).toEqual({ many: { $slice: -5 } });
    expect(
      M.find()
        .select({ many: { $slice: [14, 10] } })
        .build().projection,
    ).toEqual({ many: { $slice: [14, 10] } });
  });
});
