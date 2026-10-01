/*
 * Ported from mongoose test/model.test.js (bulkWrite, syncIndexes, createCollection, counts) onto Typemo.
 * Casting from strings/numbers the other way round is refused by Typemo's strict casters
 * (divergence L1-1): those tests assert the CastError and that nothing was written.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  BulkWriteError,
  CastError,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Index,
  Prop,
  Schema,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("ported_model");

@Schema({ collection: "p_strnum" })
class StrNum extends Entity {
  @Prop(() => String)
  str?: string;

  @Prop(() => Number)
  num?: number;
}

@Schema({ collection: "p_numbers" })
class NumberDoc extends Entity {
  @Prop(() => Number)
  number?: number;
}

@Schema({ collection: "p_unique_numbers" })
class UniqueNumber extends Entity {
  @Prop(() => Number, { unique: true, required: true })
  number!: number;
}

@Schema({ collection: "p_animals" })
class Animal extends Entity {
  @Prop(() => String)
  name?: string;
}

@Discriminator("Dog")
class Dog extends Animal {
  declare readonly __t: DiscriminatorValue<"Dog">;
  @Prop(() => String)
  breed?: string;
}

@Schema({ collection: "p_idx_users" })
class IndexedUser extends Entity {
  @Prop(() => String, { index: true })
  name?: string;

  @Prop(() => Number)
  age?: number;
}

@Schema({ collection: "p_order_users" })
@Index({ name: 1, age: -1 })
class CompoundUser extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => Number)
  age?: number;
}

@Schema({ collection: "p_blogposts" })
class BlogPost extends Entity {
  @Prop(() => String)
  title?: string;
}

beforeEach(async () => {
  await t.mongo.db
    .collection("p_idx_users")
    .drop()
    .catch(() => undefined);
  await t.mongo.db
    .collection("p_order_users")
    .drop()
    .catch(() => undefined);
});

describe("model operations (ported)", () => {
  // ported from mongoose test/model.test.js:5365 "bulkWrite casting updateMany, deleteOne, deleteMany (gh-3998)"
  test("bulkWrite casting updateMany, deleteOne, deleteMany (gh-3998) — divergence L1-1: 1 → string is refused", async () => {
    const M = t.connection.model(StrNum);
    const error = await M.bulkWrite([
      { insertOne: { document: { str: 1, num: "1" } as never } },
      { insertOne: { document: { str: "1", num: "1" } as never } },
      { updateMany: { filter: { str: 1 } as never, update: { $set: { num: "2" } } as never } },
      { deleteMany: { filter: { str: 1 } as never } },
    ]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CastError);
    expect(await M.countDocuments({})).toBe(0);
  });

  // ported from mongoose test/model.test.js:5404 "bulkWrite casting replaceOne (gh-3998)"
  test("bulkWrite casting replaceOne (gh-3998) — with values of the right types", async () => {
    const M = t.connection.model(StrNum);
    await M.bulkWrite([
      { insertOne: { document: { str: "1", num: 1 } } },
      { replaceOne: { filter: { str: "1" }, replacement: { str: "2", num: 2 } } },
    ]);
    const doc = await M.findOne({}).orFail();
    expect(doc.str).toBe("2");
    expect(doc.num).toBe(2);
  });

  // ported from mongoose test/model.test.js:5431 "bulkWrite should return insertedIds in the same order as the arguments (gh-16079)"
  test("bulkWrite should return insertedIds in the same order as the arguments (gh-16079)", async () => {
    const Model = t.connection.model(NumberDoc);
    const ops = Array.from({ length: 11 }, (_, i) => ({ insertOne: { document: { number: i } } }));
    const result = await Model.bulkWrite(ops, { ordered: false });
    const docs = await Promise.all(Object.values(result.insertedIds).map((id) => Model.findById(id)));
    expect(docs.map((doc) => doc?.number)).toEqual(ops.map((op) => op.insertOne.document.number));
  });

  // ported from mongoose test/model.test.js:5452 "bulkWrite error index should point to the right argument (gh-16079)"
  test("bulkWrite error index should point to the right argument (gh-16079)", async () => {
    const Model = t.connection.model(UniqueNumber);
    await Model.syncIndexes();
    await Model.bulkWrite(Array.from({ length: 11 }, (_, i) => ({ insertOne: { document: { number: i } } })));
    const ops2 = Array.from({ length: 21 }, (_, i) => ({ insertOne: { document: { number: 20 - i } } }));
    const error = (await Model.bulkWrite(ops2, { ordered: false }).catch(
      (caught: unknown) => caught,
    )) as BulkWriteError;
    expect(error).toBeInstanceOf(BulkWriteError);
    const errorNumbers = error.writeErrors.map(({ index }) => ops2[index]?.insertOne.document.number);
    expect(errorNumbers).toEqual(ops2.slice(-11).map((op) => op.insertOne.document.number));
    expect(error.writeErrors.every((failure) => failure.code === 11000)).toBe(true);
  });

  // ported from mongoose test/model.test.js:6767 "bulkWrite sets discriminator filters (gh-8590)"
  test("bulkWrite sets discriminator filters (gh-8590)", async () => {
    await t.connection
      .model(Dog)
      .bulkWrite([{ updateOne: { filter: { name: "Pooka" }, update: { $set: { breed: "Chorkie" } }, upsert: true } }]);
    const res = await t.connection.model(Animal).findOne().orFail();
    expect(res).toBeInstanceOf(Dog);
    expect(res instanceof Dog && res.breed).toBe("Chorkie");
  });

  // ported from mongoose test/model.test.js:7080 "Model.bulkWrite(...) does not throw an error when provided an empty array (gh-9131)"
  test("Model.bulkWrite(...) does not throw an error when provided an empty array (gh-9131)", async () => {
    const res = await t.connection.model(BlogPost).bulkWrite([]);
    expect(res).toEqual({
      insertedCount: 0,
      matchedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      upsertedCount: 0,
      upsertedIds: {},
      insertedIds: {},
    });
  });

  // ported from mongoose test/model.test.js:5678 "when syncIndexes(...) is called twice with no changes on the model, the second call should not do anything"
  test("syncIndexes twice: the second call does nothing", async () => {
    const User = t.connection.model(IndexedUser);
    await t.mongo.db.collection("p_idx_users").createIndex({ age: 1 });
    const first = await User.syncIndexes();
    const second = await User.syncIndexes();
    expect(first.toDrop).toEqual(["age_1"]);
    expect(second.toDrop).toEqual([]);
    expect(second.toCreate).toEqual([]);
  });

  // ported from mongoose test/model.test.js:5698 "when called with different key order, it treats different order as different indexes (gh-8135)"
  test("different key order is a different index (gh-8135)", async () => {
    const User = t.connection.model(CompoundUser);
    await t.mongo.db.collection("p_order_users").createIndex({ age: -1, name: 1 });
    const result = await User.syncIndexes();
    expect(result.toDrop).toEqual(["age_-1_name_1"]);
    const after = await User.listIndexes();
    expect(after.find((index) => index.key.name === 1 && index.key.age === -1)?.name).toBe("name_1_age_-1");
  });

  // ported from mongoose test/model.test.js:6400 "createCollection() handles NamespaceExists errors (gh-9447)"
  test("createCollection() handles NamespaceExists errors (gh-9447)", async () => {
    const Model = t.connection.model(BlogPost);
    await t.mongo.db
      .collection("p_blogposts")
      .drop()
      .catch(() => undefined);
    await Model.createCollection();
    await Model.createCollection();
  });

  // ported from mongoose test/model.test.js:2273 "countDocuments()" and :2281 "estimatedDocumentCount()"
  test("countDocuments() and estimatedDocumentCount()", async () => {
    const Posts = t.connection.model(BlogPost);
    await Posts.create({ title: "foo" });
    expect(await Posts.countDocuments({ title: "foo" }).exec()).toBe(1);
    expect(await Posts.estimatedDocumentCount().exec()).toBe(1);
  });
});
