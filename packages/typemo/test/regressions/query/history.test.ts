/*
 * Regressions from research/mongoose/M11-history/history.yaml, `area: query` and `area: update`, that
 * apply to the types and plans of the query builder (`how_to_test` of each entry). Casting, policies, hooks and
 * bulk operations are covered by the execution tests.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import {
  BsonOptions,
  Filters,
  type FindPlan,
  ProjectionPlanner,
  QueryError,
  SchemaCompiler,
  type WritePlan,
} from "../../../src/internal.ts";
import { Member } from "../../fixtures/query/query-entities.ts";
import { IDS, models, seed } from "../../fixtures/query/seed.ts";

const mongo = MongoLifecycle.useMongo("query_history", BsonOptions.apply({}));
const { Members, runner } = models(() => mongo.db);

beforeEach(async () => {
  await seed(mongo.db);
});

describe("history.yaml: query and update", () => {
  test("H009: a dotted inclusion selects only that leaf of the parent", async () => {
    const doc = await Members.findById(IDS.ann).select({ "profile.address.city": 1 }).orFail().lean();
    expect(doc).toEqual({ _id: IDS.ann, profile: { address: { city: "Paris" } } });
  });

  test("H020: excluding a parent of a hidden field is not a path collision", async () => {
    const doc = await Members.findById(IDS.ann).select({ profile: 0 }).orFail().lean();
    expect(["profile" in doc, "passwordHash" in doc]).toEqual([false, false]);
  });

  test("H021: updateOne without upsert sends exactly the update (no $setOnInsert added)", () => {
    const plan = Members.updateOne({ _id: IDS.ann }, { $set: { name: "x" } }).build() as WritePlan;
    expect(plan.update).toEqual({ $set: { name: "x" } });
    expect(plan.upsert).toBe(false);
  });

  test("H022: an empty operator ($addToSet: {}) is an error before the server", () => {
    // @ts-expect-error an empty operator
    expect(() => Members.updateOne(Filters.all(), { $addToSet: {} })).toThrow(/operator "\$addToSet" is empty/);
  });

  test("H040 / H056: a `__proto__` key in an update or a filter never touches a prototype", () => {
    const update = JSON.parse('{"$set": {"__proto__": {"polluted": true}}}') as never;
    // The plan keeps it as a plain key (execution refuses it as an unknown path: the schema forbids the name).
    const written = (Members.updateOne(Filters.all(), update).build() as WritePlan).update as { $set: object };
    expect(Object.hasOwn(written.$set, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(written.$set)).toBe(Object.prototype);
    const filter = JSON.parse('{"__proto__.x": 1, "name": "a"}') as never;
    const plan = Members.find(filter).build();
    expect(Object.keys(plan.filter)).toEqual(["__proto__.x", "name"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("H054: updateOne with a null update is a readable error, not a TypeError", () => {
    expect(() => Members.updateOne(Filters.all(), null as never)).toThrow(/update: an object of update operators/);
  });

  test("H059: returnDocument 'before' | 'after' only (no `new`)", () => {
    // @ts-expect-error `new` is not an option
    Members.findOneAndUpdate({}, { $set: { name: "x" } }, { new: true });
  });

  test("H090 / H112 / H446 / H472: findOne(null) and findById(undefined) are errors; findOne() is all", () => {
    expect(() => Members.findOne(null as never)).toThrow(/filter: an object/);
    expect(() => Members.findById(undefined as never)).toThrow(/an id is required/);
    expect(Members.findOne().build().filter).toEqual({});
  });

  test("H091 / H071: an update pipeline array is refused until the pipeline builder's update mode", () => {
    // @ts-expect-error an array is not an update document
    expect(() => Members.updateOne(Filters.all(), [{ $set: { name: "x" } }])).toThrow(/pipeline builder/);
  });

  test("H105: $push: { $each: [...] } without a path is a readable error", () => {
    // @ts-expect-error `$each` is not a path
    expect(() => Members.updateOne(Filters.all(), { $push: { $each: [1] } })).toThrow(
      /a path is expected, not an operator/,
    );
  });

  test("H126: filter and update are required positional arguments", () => {
    // @ts-expect-error no update
    expect(() => Members.updateOne({ name: "x" })).toThrow(QueryError);
  });

  test("H172: $rename to a non-path is refused", () => {
    // @ts-expect-error a number is not a target path
    expect(() => Members.updateOne(Filters.all(), { $rename: { nickname: 5 } })).toThrow(/needs a target path/);
  });

  test("H196: or(list) never mutates the list", () => {
    const or = [{ name: "a" }] as const;
    Members.find()
      .or(or)
      .or([{ name: "b" }]);
    expect(or).toEqual([{ name: "a" }]);
  });

  test("H323 / H337: `+field` works on findOneAndUpdate and on a cursor", async () => {
    const updated = await Members.findOneAndUpdate({ _id: IDS.ann }, { $set: { age: 35 } })
      .select({ "+passwordHash": true })
      .orFail()
      .lean();
    expect(updated.passwordHash).toBe("hash-ann");
    const seen: (string | undefined)[] = [];
    for await (const member of Members.find({ _id: IDS.ann }).select({ "+passwordHash": true }).lean().cursor())
      seen.push(member.passwordHash);
    expect(seen).toEqual(["hash-ann"]);
  });

  test("H352: an $elemMatch projection with a Date is recognized as a projection (inclusion)", () => {
    expect(ProjectionPlanner.modeOfProjection({ tags: { $elemMatch: { $eq: new Date() } } })).toBe("include");
  });

  test('H400: a write awaited twice runs once, the second await is a clear error (H5; Mongoose: "Query was already executed")', async () => {
    const query = Members.updateOne({ _id: IDS.bob }, { $inc: { age: 1 } });
    const before = runner.runs.length;
    await query;
    await expect(query.exec()).rejects.toThrow(/already executed; build a new one/);
    expect(runner.runs.length - before).toBe(1);
  });

  test("H415: $set: { a: undefined } is an error, not a silent no-op", () => {
    // @ts-expect-error undefined is never a value
    expect(() => Members.updateOne(Filters.all(), { $set: { age: undefined } })).toThrow(/undefined at "\$set\.age"/);
  });

  test("H426: find() without select sends no projection unless the schema has hidden fields", () => {
    expect((Members.find().build() as FindPlan).projection).toBeUndefined();
    expect(ProjectionPlanner.effective(SchemaCompiler.compile(Member), undefined)).toEqual({
      passwordHash: 0,
      "profile.secretNote": 0,
    });
  });

  test("H436: one object used twice in a filter is copied twice (no aliasing)", () => {
    const value = { $gt: 1 };
    const plan = Members.find({ age: value, "counters.logins": value }).build();
    expect(plan.filter.age).toEqual(value);
    expect(plan.filter.age).not.toBe(plan.filter["counters.logins"]);
  });

  test("H437: { _id: 0 } with a hidden field in the schema", async () => {
    const doc = await Members.findById(IDS.ann).select({ _id: 0 }).orFail().lean();
    expect(["_id" in doc, "passwordHash" in doc, doc.name]).toEqual([false, false, "Ann"]);
  });

  test("H463: delete results are the driver's DeleteResult", async () => {
    expect(await Members.deleteMany({ _id: new ObjectId() })).toEqual({ acknowledged: true, deletedCount: 0 });
  });
});
