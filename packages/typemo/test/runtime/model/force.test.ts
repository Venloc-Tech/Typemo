/*
 * `exec({ force: true })`. A read builder's repeated `await` returns the cached
 * result; `force` runs it again and the cache takes the new result. A write builder's repeated
 * `await` is an error; `force` sends it again, deliberately. Everywhere a builder caches or runs
 * once: find*, count*, distinct, exists, aggregate and every write.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { type Model, QueryError } from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("force");
const ann = new ObjectId();
let People: Model<Person>;

beforeEach(async () => {
  People = t.connection.model(Person);
  await t.mongo.db.collection("m_people").insertOne({
    _id: ann,
    name: "Ann",
    email: "ann@x.test",
    age: 30,
    role: "admin",
    tags: [],
    pets: [],
    lastSeen: null,
  });
  t.commands.clear();
});

/**
 * Inserts a second person straight into the collection.
 * @returns The insert result.
 */
const addBob = () =>
  t.mongo.db.collection("m_people").insertOne({
    name: "Bob",
    email: "bob@x.test",
    age: 20,
    role: "user",
    tags: [],
    pets: [],
    lastSeen: null,
  });

/**
 * How many commands of a name were sent.
 * @param name The command name.
 * @returns The count.
 */
const sent = (name: string) => t.commands.byName(name).length;

describe("reads — the cache, and force", () => {
  test("find: a second await is cached; force re-runs and refreshes the cache", async () => {
    const query = People.find().lean();
    expect((await query).length).toBe(1);
    await addBob();
    expect((await query).length).toBe(1); /* cached */
    expect(sent("find")).toBe(1);
    expect((await query.exec({ force: true })).length).toBe(2);
    expect(sent("find")).toBe(2);
    expect((await query).length).toBe(2); /* the cache holds the forced result */
    expect(sent("find")).toBe(2);
    expect((await query.exec({ force: false })).length).toBe(2); /* force: false is the default */
    expect(sent("find")).toBe(2);
  });

  test("findOne / findById", async () => {
    const query = People.findById(ann);
    const first = await query;
    await t.mongo.db.collection("m_people").updateOne({ _id: ann }, { $set: { age: 31 } });
    expect(await query).toBe(first);
    expect((await query.exec({ force: true }))?.age).toBe(31);
    expect((await query)?.age).toBe(31);
    expect(sent("find")).toBe(2);
  });

  test("countDocuments / estimatedDocumentCount / distinct / exists", async () => {
    const count = People.countDocuments();
    const estimated = People.estimatedDocumentCount();
    const names = People.distinct("name");
    const bob = People.exists({ name: "Bob" });
    expect([await count, await estimated, await names, await bob]).toEqual([1, 1, ["Ann"], null]);
    await addBob();
    expect([await count, await estimated, await names, await bob]).toEqual([1, 1, ["Ann"], null]);
    expect(await count.exec({ force: true })).toBe(2);
    expect(await estimated.exec({ force: true })).toBe(2);
    expect(await names.exec({ force: true })).toEqual(["Ann", "Bob"]);
    expect(await bob.exec({ force: true })).not.toBeNull();
    expect([await count, await estimated, await names]).toEqual([2, 2, ["Ann", "Bob"]]);
  });

  test("aggregate (a read pipeline)", async () => {
    const query = People.aggregate((p) => p.match({}).project(() => ({ name: 1, _id: 0 })));
    expect(await query).toEqual([{ name: "Ann" }]);
    await addBob();
    expect(await query).toEqual([{ name: "Ann" }]);
    expect(sent("aggregate")).toBe(1);
    expect((await query.exec({ force: true })).length).toBe(2);
    expect((await query).length).toBe(2);
    expect(sent("aggregate")).toBe(2);
  });
});

describe("writes — once, unless forced", () => {
  test("updateOne: a second await is an error; force sends it again", async () => {
    const write = People.updateOne({ _id: ann }, { $inc: { age: 1 } });
    await write;
    await expect(write.exec()).rejects.toThrow(/already executed.*exec\(\{ force: true \}\)/);
    expect((await write.exec({ force: true })).modifiedCount).toBe(1);
    expect((await t.mongo.db.collection("m_people").findOne({ _id: ann }))?.age).toBe(32);
    /* a forced run does not make later plain awaits legal */
    await expect(write.exec()).rejects.toThrow(QueryError);
    expect(sent("update")).toBe(2);
  });

  test("updateMany / replaceOne / deleteOne / deleteMany", async () => {
    const many = People.updateMany({ role: "admin" }, { $inc: { age: 1 } });
    await many;
    await many.exec({ force: true });
    const replace = People.replaceOne(
      { _id: ann },
      { name: "Ann", email: "ann@x.test", tags: [], pets: [], lastSeen: null },
    );
    await replace;
    await expect(replace.exec()).rejects.toThrow(/already executed/);
    await replace.exec({ force: true });
    await addBob();
    const deleteOne = People.deleteOne({ name: "Bob" });
    expect((await deleteOne).deletedCount).toBe(1);
    await addBob();
    expect((await deleteOne.exec({ force: true })).deletedCount).toBe(1);
    const deleteMany = People.deleteMany({ name: "nobody" });
    await deleteMany;
    await expect(deleteMany.exec()).rejects.toThrow(/already executed/);
    expect((await deleteMany.exec({ force: true })).deletedCount).toBe(0);
  });

  test("findOneAndUpdate / findOneAndDelete", async () => {
    const modify = People.findOneAndUpdate({ _id: ann }, { $inc: { age: 1 } });
    expect((await modify)?.age).toBe(31);
    await expect(modify.exec()).rejects.toThrow(/already executed/);
    expect((await modify.exec({ force: true }))?.age).toBe(32);
    const remove = People.findOneAndDelete({ _id: ann });
    expect((await remove)?.name).toBe("Ann");
    expect(await remove.exec({ force: true })).toBeNull();
  });

  test("aggregate with $out is a write", async () => {
    const out = People.aggregate((p) => p.match({}).out("m_force_out"));
    await out;
    await expect(out.exec()).rejects.toThrow(/already executed/);
    await addBob();
    await out.exec({ force: true });
    expect(await t.mongo.db.collection("m_force_out").countDocuments()).toBe(2);
  });

  test("force must be a boolean (no silent coercion)", async () => {
    const query = People.find();
    expect(() => query.exec({ force: "yes" } as never)).toThrow(QueryError);
    expect(() => query.exec(null as never)).toThrow(QueryError);
  });
});
