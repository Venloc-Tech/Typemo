/*
 * The input of every model operation is left as it was — frozen inputs work (a mutation would throw), and
 * nothing in them changes (Mongoose mutated them in bulkWrite, insertMany, findOneAndDelete and connection
 * options; Mongoose H328).
 */
import { describe, expect, test } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import { TypemoClient } from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("nomut");

/** Freezes `value` and everything reachable from it. */
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};

/** A stable JSON text of `value` (bigint-safe) to compare before and after. */
const snapshot = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? `${v}n` : v));

describe("no input mutation", () => {
  test("create / insertOne / insertMany with frozen documents (the driver would add _id to them)", async () => {
    const People = t.connection.model(Person);
    const doc = deepFreeze({ name: "A", email: "a@x.test", tags: ["t"], pets: [{ name: "Rex" }], lastSeen: null });
    const before = snapshot(doc);
    await People.create(doc);
    await People.insertOne({ ...doc, email: "b@x.test" });
    const many = deepFreeze([
      { name: "C", email: "c@x.test", tags: [], pets: [], lastSeen: null },
      { name: "D", email: "d@x.test", tags: [], pets: [], lastSeen: null },
    ]);
    const manyBefore = snapshot(many);
    await People.insertMany(many, { ordered: false });
    expect(snapshot(doc)).toBe(before);
    expect(snapshot(many)).toBe(manyBefore);
    expect("_id" in doc).toBe(false);
  });

  test("bulkWrite with frozen operations", async () => {
    const People = t.connection.model(Person);
    const id = new ObjectId();
    const operations = deepFreeze([
      { insertOne: { document: { _id: id, name: "E", email: "e@x.test", tags: [], pets: [], lastSeen: null } } },
      { updateOne: { filter: { _id: id }, update: { $set: { age: 3 } }, upsert: false } },
      {
        replaceOne: {
          filter: { _id: id },
          replacement: { name: "F", email: "e@x.test", tags: [], pets: [], lastSeen: null },
        },
      },
      { deleteMany: { filter: { name: "Nobody" } } },
    ] as const);
    const before = snapshot(operations);
    await People.bulkWrite(operations);
    expect(snapshot(operations)).toBe(before);
  });

  test("filters, updates and options of builders; aggregation; find-and-modify options", async () => {
    const People = t.connection.model(Person);
    const filter = deepFreeze({
      name: { $in: ["A", "B"] },
      $or: [{ age: { $gte: 1 } }, { age: { $exists: false } }],
    } as const);
    const update = deepFreeze({ $set: { age: 5 }, $push: { tags: { $each: ["x"] } } } as const);
    const options = deepFreeze({ upsert: false, returnDocument: "before" as const });
    const before = [snapshot(filter), snapshot(update), snapshot(options)];
    await People.find(filter).sort(deepFreeze({ name: 1 }) as { name: 1 });
    await People.updateMany(filter, update);
    await People.findOneAndUpdate(filter, update, options);
    await People.findOneAndDelete(filter);
    await People.countDocuments(filter);
    await People.distinct("name", filter);
    await People.aggregate((p) => p.match(filter));
    expect([snapshot(filter), snapshot(update), snapshot(options)]).toEqual(before);
  });

  test("client options are not mutated (Mongoose H328)", async () => {
    const options = deepFreeze({ dbName: t.mongo.dbName, readyTimeoutMS: 1000, maxPoolSize: 3 });
    const before = snapshot(options);
    const client = new TypemoClient(MongoHarness.getUri(), options);
    await client.close();
    expect(snapshot(options)).toBe(before);
  });
});
