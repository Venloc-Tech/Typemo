/*
 * Filter-based writes and find-and-modify through the pipeline, on the real server — results
 * normalized to the builder's types, orFail, `returnDocument: "after"` by default, upsert, the raw
 * result with metadata, findByIdAnd*, a write runs once.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { DocumentNotFoundError, type Model, QueryError } from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("writes");
const ids = { ann: new ObjectId(), bob: new ObjectId() };
let People: Model<Person>;

beforeEach(async () => {
  People = t.connection.model(Person);
  await t.mongo.db.collection("m_people").insertMany([
    { _id: ids.ann, name: "Ann", email: "ann@x.test", age: 34, role: "admin", tags: ["a"], pets: [], lastSeen: null },
    { _id: ids.bob, name: "Bob", email: "bob@x.test", age: 17, role: "user", tags: [], pets: [], lastSeen: null },
  ]);
});

/**
 * Reads a person straight from the collection.
 * @param id The person id.
 * @returns The stored raw document.
 */
const stored = (id: ObjectId) => t.mongo.db.collection("m_people").findOne({ _id: id });

describe("updateOne / updateMany / replaceOne", () => {
  test("results are the UpdateResult (upsertedId null when nothing was upserted)", async () => {
    expect(await People.updateOne({ _id: ids.ann }, { $inc: { age: 1 } })).toEqual({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    });
    expect((await stored(ids.ann))?.age).toBe(35);
    const many = await People.updateMany({ role: { $in: ["admin", "user"] } }, { $push: { tags: "x" } });
    expect([many.matchedCount, many.modifiedCount]).toEqual([2, 2]);
  });

  test("upsert returns the new _id typed by the entity", async () => {
    const result = await People.updateOne(
      { email: "new@x.test" },
      { $setOnInsert: { name: "New", tags: [], pets: [], lastSeen: null } },
      { upsert: true },
    );
    expect(result.upsertedCount).toBe(1);
    expect(result.upsertedId).toBeInstanceOf(ObjectId);
  });

  test("orFail: nothing matched is DocumentNotFoundError (an upsert counts as found)", async () => {
    const error = await People.updateOne({ name: "Nobody" }, { $set: { age: 1 } })
      .orFail()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocumentNotFoundError);
    await People.updateOne({ email: "u@x.test" }, { $set: { name: "U" } }, { upsert: true }).orFail();
  });

  test("replaceOne keeps the _id and replaces the rest", async () => {
    const result = await People.replaceOne(
      { _id: ids.bob },
      { name: "Robert", email: "bob@x.test", role: "user", tags: [], pets: [], lastSeen: null },
    );
    expect(result.modifiedCount).toBe(1);
    const doc = await stored(ids.bob);
    expect([doc?.name, doc?.age]).toEqual(["Robert", undefined]);
  });

  test("an update pipeline (5B builder) runs on the server", async () => {
    const { fn } = await import("../../../src/index.ts");
    await People.updateOne({ _id: ids.bob }, (p) => p.set((f) => ({ age: fn.add(f.age, 3) })));
    expect((await stored(ids.bob))?.age).toBe(20);
  });
});

describe("deleteOne / deleteMany", () => {
  test("DeleteResult; orFail on nothing deleted", async () => {
    expect(await People.deleteOne({ _id: ids.bob })).toEqual({ acknowledged: true, deletedCount: 1 });
    await expect(People.deleteOne({ _id: ids.bob }).orFail().exec()).rejects.toThrow(DocumentNotFoundError);
    expect((await People.deleteMany({ role: "admin" })).deletedCount).toBe(1);
  });
});

describe("findOneAndUpdate / Replace / Delete, findByIdAnd*", () => {
  test("AFTER by default, BEFORE on request; hydrated or lean", async () => {
    const after = await People.findOneAndUpdate({ _id: ids.ann }, { $set: { age: 40 } });
    expect(after).toBeInstanceOf(Person);
    expect(after?.age).toBe(40);
    const before = await People.findOneAndUpdate(
      { _id: ids.ann },
      { $set: { age: 41 } },
      { returnDocument: "before" },
    ).lean();
    expect(before?.age).toBe(40);
  });

  test("upsert + after always returns a document; the metadata form on request", async () => {
    const created = await People.findOneAndUpdate(
      { email: "z@x.test" },
      { $set: { name: "Zed", tags: [], pets: [], lastSeen: null } },
      { upsert: true },
    ).lean();
    expect(created.name).toBe("Zed");
    const raw = await People.findOneAndUpdate({ email: "z@x.test" }, { $set: { age: 9 } }).includeResultMetadata();
    expect(raw.ok).toBe(1);
    expect(raw.lastErrorObject?.updatedExisting).toBe(true);
    expect(raw.value?.age).toBe(9);
  });

  test("findOneAndReplace and findOneAndDelete; orFail on no match", async () => {
    const replaced = await People.findOneAndReplace(
      { _id: ids.bob },
      { name: "Bobby", email: "bob@x.test", role: "user", tags: [], pets: [], lastSeen: null },
    ).lean();
    expect(replaced?.name).toBe("Bobby");
    const deleted = await People.findOneAndDelete({ _id: ids.bob }).lean();
    expect(deleted?.name).toBe("Bobby");
    await expect(People.findOneAndDelete({ _id: ids.bob }).orFail().exec()).rejects.toThrow(DocumentNotFoundError);
  });

  test("findByIdAndUpdate / findByIdAndDelete; an id is required", async () => {
    expect((await People.findByIdAndUpdate(ids.ann, { $set: { age: 50 } }))?.age).toBe(50);
    expect((await People.findByIdAndDelete(ids.bob).lean())?.name).toBe("Bob");
    expect(() => People.findByIdAndDelete(undefined as never)).toThrow(QueryError);
  });

  test("a find-and-modify is a write — a second await of the same builder is an error", async () => {
    const write = People.findOneAndUpdate({ _id: ids.ann }, { $inc: { age: 1 } });
    await write;
    await expect(write.exec()).rejects.toThrow(/already executed; build a new one/);
    expect((await stored(ids.ann))?.age).toBe(35);
  });
});
