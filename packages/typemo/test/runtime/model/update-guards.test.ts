/*
 * On the real server: two updates the server refuses only once a document matches are refused before anything is
 * sent, as Typemo errors — a replacement that carries `_id` (the server: code 66 ImmutableField) and a positional
 * `$` whose array the filter does not name (the server: code 2, "did not find the match needed from the query").
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { type Model, QueryError, StrictModeError } from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("update_guards");
const ids = { ann: new ObjectId(), bob: new ObjectId() };
let People: Model<Person>;

beforeEach(async () => {
  People = t.connection.model(Person);
  await t.mongo.db.collection("m_people").insertMany([
    {
      _id: ids.ann,
      name: "Ann",
      email: "ann@x.test",
      role: "user",
      tags: [],
      pets: [
        { name: "Rex", age: 3 },
        { name: "Tom", age: 5 },
      ],
      lastSeen: null,
    },
    { _id: ids.bob, name: "Bob", email: "bob@x.test", role: "user", tags: [], pets: [], lastSeen: null },
  ]);
  t.commands.clear();
});

/**
 * The error a builder rejects with.
 * @param run - Starts the operation.
 * @returns What it rejected with, or `undefined` when it resolved.
 */
const errorOf = async (run: () => PromiseLike<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};

/** Every write command the tests sent. */
const writes = () => [...t.commands.byName("update"), ...t.commands.byName("findAndModify")];

/** A replacement of Bob as untyped input: the types leave `_id` out of a replacement. */
const replacement = (id: ObjectId) =>
  /* cast: `_id` in a replacement is what the runtime check is about; the types refuse it */
  ({ _id: id, name: "Robert", email: "bob@x.test", role: "user", tags: [], pets: [], lastSeen: null }) as never;

describe("a replacement that carries _id", () => {
  test("replaceOne with another _id: StrictModeError immutable before sending (not the server's code 66)", async () => {
    const error = await errorOf(() => People.replaceOne({ _id: ids.bob }, replacement(ids.ann)));
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("immutable");
    expect((error as StrictModeError).path).toBe("_id");
    expect((error as Error).message).toBe(
      'a replacement of Person carries "_id": a replacement keeps the stored _id and cannot change it; leave "_id" out and select the document by _id in the filter [immutable]',
    );
    expect(writes()).toEqual([]);
    expect((await t.mongo.db.collection("m_people").findOne({ _id: ids.bob }))?.name).toBe("Bob");
  });

  test("the same _id, findOneAndReplace, an upsert and bulkWrite are refused the same way", async () => {
    expect(await errorOf(() => People.replaceOne({ _id: ids.bob }, replacement(ids.bob)))).toBeInstanceOf(
      StrictModeError,
    );
    expect(await errorOf(() => People.findOneAndReplace({ _id: ids.bob }, replacement(ids.ann)))).toBeInstanceOf(
      StrictModeError,
    );
    const fresh = new ObjectId();
    expect(
      await errorOf(() => People.replaceOne({ name: "Nobody" }, replacement(fresh), { upsert: true })),
    ).toBeInstanceOf(StrictModeError);
    expect(
      await errorOf(() =>
        People.bulkWrite([{ replaceOne: { filter: { _id: ids.bob }, replacement: replacement(ids.ann) } }]),
      ),
    ).toBeInstanceOf(StrictModeError);
    expect(writes()).toEqual([]);
    expect(t.commands.byName("bulkWrite")).toEqual([]);
  });

  test("a replacement without _id keeps the stored one", async () => {
    await People.replaceOne(
      { _id: ids.bob },
      { name: "Robert", email: "bob@x.test", role: "user", tags: [], pets: [], lastSeen: null },
    );
    expect((await t.mongo.db.collection("m_people").findOne({ _id: ids.bob }))?.name).toBe("Robert");
  });
});

describe("a positional $ needs a condition on its array in the filter", () => {
  test("no condition on the array: QueryError before sending (not the server's code 2)", async () => {
    const error = await errorOf(() => People.updateOne({ _id: ids.ann }, { $set: { "pets.$.age": 9 } }));
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).path).toBe("$set.pets.$.age");
    expect((error as Error).message).toBe(
      '$set: "pets.$.age" uses the positional $ of the array "pets", but the filter has no condition on "pets"; the server would refuse the update once a document matches. Add a condition on "pets" to the filter, or use $[] (every element) or $[id] with arrayFilters',
    );
    expect(writes()).toEqual([]);
  });

  test("updateMany, findOneAndUpdate, $inc and bulkWrite are refused the same way", async () => {
    expect(await errorOf(() => People.updateMany({ name: "Ann" }, { $inc: { "pets.$.age": 1 } }))).toBeInstanceOf(
      QueryError,
    );
    expect(
      await errorOf(() => People.findOneAndUpdate({ _id: ids.ann }, { $set: { "pets.$.name": "Max" } })),
    ).toBeInstanceOf(QueryError);
    expect(
      await errorOf(() =>
        People.bulkWrite([{ updateOne: { filter: { _id: ids.ann }, update: { $set: { "pets.$.age": 1 } } } }]),
      ),
    ).toBeInstanceOf(QueryError);
    expect(writes()).toEqual([]);
    expect(t.commands.byName("bulkWrite")).toEqual([]);
  });

  test("a condition on the array — a path below it, $elemMatch, inside $and or $or — lets the update through", async () => {
    await People.updateOne({ _id: ids.ann, "pets.name": "Rex" }, { $set: { "pets.$.age": 4 } });
    await People.updateOne({ _id: ids.ann, pets: { $elemMatch: { name: "Tom" } } }, { $set: { "pets.$.age": 6 } });
    await People.updateOne({ $and: [{ _id: ids.ann }, { "pets.name": "Rex" }] }, { $inc: { "pets.$.age": 1 } });
    await People.updateOne({ _id: ids.ann, $or: [{ "pets.name": "Tom" }] }, { $inc: { "pets.$.age": 1 } });
    const stored = await t.mongo.db.collection("m_people").findOne({ _id: ids.ann });
    expect(stored?.pets).toEqual([
      { name: "Rex", age: 5 },
      { name: "Tom", age: 7 },
    ]);
  });

  test("$[] and $[id] with arrayFilters need no condition", async () => {
    await People.updateOne({ _id: ids.ann }, { $inc: { "pets.$[].age": 1 } });
    await People.updateOne({ _id: ids.ann }, { $set: { "pets.$[p].age": 0 } }, { arrayFilters: [{ "p.name": "Rex" }] });
    const stored = await t.mongo.db.collection("m_people").findOne({ _id: ids.ann });
    expect(stored?.pets).toEqual([
      { name: "Rex", age: 0 },
      { name: "Tom", age: 6 },
    ]);
  });
});
