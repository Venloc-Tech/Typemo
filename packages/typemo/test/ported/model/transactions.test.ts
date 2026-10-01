/*
 * Ported from mongoose test/docs/transactions.test.js onto Typemo. Tests that rely on
 * the document layer (`save()`, `$isNew`, `$session()`, snapshots) and populate are
 * listed in test/ported/INDEX.md; the rollback MECHANISM they need is tested with a
 * fake participant in test/runtime/connection/transactions.test.ts.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Entity, fn, type Model, Prop, Schema } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("ported_txn");

@Schema({ collection: "p_customers" })
class Customer extends Entity {
  @Prop(() => String)
  name?: string;
}

@Schema({ collection: "p_events" })
class TxEvent extends Entity {
  @Prop(() => Date, { required: true })
  createdAt!: Date;
}

@Schema({ collection: "p_characters" })
class Character extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => String)
  rank?: string;
}

let Customers: Model<Customer>;

beforeEach(async () => {
  Customers = t.connection.model(Customer);
  await Customers.createCollection();
  await t.connection.model(TxEvent).createCollection();
  await t.connection.model(Character).createCollection();
});

describe("transactions (ported)", () => {
  // ported from mongoose test/docs/transactions.test.js:44 "basic example"
  test("basic example", async () => {
    const session = await t.client.startSession();
    session.startTransaction();
    await Customers.create([{ name: "Test" }], { session });
    // Transactions execute in isolation: without the session the document is not visible yet.
    expect(await Customers.findOne({ name: "Test" }).session(null)).toBeNull();
    expect(await Customers.findOne({ name: "Test" }).session(session)).not.toBeNull();
    await session.commitTransaction();
    expect(await Customers.findOne({ name: "Test" })).not.toBeNull();
    await session.endSession();
  });

  // ported from mongoose test/docs/transactions.test.js:75 "withTransaction"
  test("withTransaction", async () => {
    const session = await Customers.startSession();
    await session.withTransaction(() => Customers.create([{ name: "Test" }], { session }));
    expect(await Customers.countDocuments()).toBe(1);
    await session.endSession();
  });

  // ported from mongoose test/docs/transactions.test.js:95 "abort"
  test("abort", async () => {
    const session = await Customers.startSession();
    session.startTransaction();
    await Customers.create([{ name: "Test" }], { session });
    await Customers.create([{ name: "Test2" }], { session });
    await session.abortTransaction();
    expect(await Customers.countDocuments()).toBe(0);
    await session.endSession();
  });

  // ported from mongoose test/docs/transactions.test.js:168 "aggregate"
  test("aggregate", async () => {
    const Events = t.connection.model(TxEvent);
    const session = await t.client.startSession();
    session.startTransaction();
    await Events.insertMany(
      [
        { createdAt: new Date("2018-06-01") },
        { createdAt: new Date("2018-06-02") },
        { createdAt: new Date("2017-06-01") },
        { createdAt: new Date("2017-05-31") },
      ],
      { session },
    );
    const res = await Events.aggregate((p) =>
      p
        .group((f) => ({ _id: { month: fn.month(f.createdAt), year: fn.year(f.createdAt) }, count: fn.sum(1) }))
        .sort({ count: -1, "_id.year": -1, "_id.month": -1 }),
    ).session(session);
    expect(res).toEqual([
      { _id: { month: 6, year: 2018 }, count: 2 },
      { _id: { month: 6, year: 2017 }, count: 1 },
      { _id: { month: 5, year: 2017 }, count: 1 },
    ]);
    await session.commitTransaction();
    await session.endSession();
  });

  // ported from mongoose test/docs/transactions.test.js:291 "deleteOne and deleteMany (gh-7857)(gh-6805)"
  test("deleteOne and deleteMany (gh-7857)(gh-6805)", async () => {
    const Characters = t.connection.model(Character);
    const session = await t.client.startSession();
    session.startTransaction();
    await Characters.insertMany(
      [
        { name: "Tyrion Lannister" },
        { name: "Cersei Lannister" },
        { name: "Jon Snow" },
        { name: "Daenerys Targaryen" },
      ],
      { session },
    );
    await Characters.deleteMany({ name: /Lannister/ }).session(session);
    await Characters.deleteOne({ name: "Jon Snow" }).session(session);
    const res = await Characters.find({}).session(session);
    expect(res.length).toBe(1);
    await session.commitTransaction();
    await session.endSession();
  });

  // ported from mongoose test/docs/transactions.test.js:341 "distinct (gh-8006)"
  test("distinct (gh-8006)", async () => {
    const Characters = t.connection.model(Character);
    const session = await t.client.startSession();
    session.startTransaction();
    await Characters.create(
      [
        { name: "Will Riker", rank: "Commander" },
        { name: "Jean-Luc Picard", rank: "Captain" },
      ],
      { session },
    );
    let names = await Characters.distinct("name", {}).session(session);
    expect(names.sort()).toEqual(["Jean-Luc Picard", "Will Riker"]);
    names = await Characters.distinct("name", { rank: "Captain" }).session(session);
    expect(names.sort()).toEqual(["Jean-Luc Picard"]);
    await session.abortTransaction();
    await session.endSession();
  });

  // ported from mongoose test/docs/transactions.test.js:389 "transaction() sets `session` by default if transactionAsyncLocalStorage option is set"
  test("transaction() sets `session` by default (ALS, always on in Typemo)", async () => {
    const Test = t.connection.model(Customer);
    let created: Customer | undefined;
    await expect(
      t.connection.transaction(async () => {
        created = await Test.create({ name: "test_transactionAsyncLocalStorage" });
        await Test.updateOne({ name: "foo" }, { $set: { name: "foo" } }, { upsert: true });
        let docs = await Test.aggregate((p) => p.match({ _id: created?._id as never }));
        expect(docs.length).toBe(1);
        const aggCursor = Test.aggregate((p) => p.match({ _id: created?._id as never })).cursor();
        docs = [(await aggCursor.next()) as never];
        await aggCursor.close();
        expect((docs[0] as { name?: string }).name).toBe("test_transactionAsyncLocalStorage");
        const found = await Test.find({ _id: created?._id as never });
        expect(found.length).toBe(1);
        await (async () => Test.findOne({ _id: created?._id as never }))();
        await Test.insertMany([{ name: "bar" }]);
        throw new Error("Oops!");
      }),
    ).rejects.toThrow(/Oops!/);
    expect(await Test.exists({ _id: created?._id as never })).toBeNull();
    expect(await Test.exists({ name: "foo" })).toBeNull();
    expect(await Test.exists({ name: "bar" })).toBeNull();
    await expect(
      t.connection.transaction(async () => {
        created = await Test.create({ name: "test_transactionAsyncLocalStorage" }, { session: null });
        throw new Error("Oops!");
      }),
    ).rejects.toThrow(/Oops!/);
    expect(await Test.exists({ _id: created?._id as never })).not.toBeNull();
  });

  // ported from mongoose test/docs/transactions.test.js:709 "doesnt apply schema write concern to transaction operations (gh-11382)"
  test("doesnt apply schema write concern to transaction operations (gh-11382) — no schema write concern in Typemo; a per-operation one is an error", async () => {
    const session = await t.client.startSession();
    await session.withTransaction(async () => {
      await Customers.findOneAndUpdate({ name: { $exists: true } }, { $set: { name: "test" } }).session(session);
    });
    await session.endSession();
    const error = await t.connection
      .transaction(async () =>
        Customers.updateOne({ name: "x" }, { $set: { name: "y" } }).writeConcern({ w: "majority" }),
      )
      .catch((caught: unknown) => caught);
    expect((error as Error).name).toBe("StrictModeError");
  });

  // ported from mongoose test/docs/transactions.test.js:754 "throws error if using `create()` with multiple docs in a transaction (gh-15091)"
  test("create() with multiple docs in a transaction (gh-15091) — divergence L4A-3: allowed, create([...]) is ONE ordered insert", async () => {
    const session = await t.client.startSession();
    session.startTransaction();
    const bookings = await Customers.create([{ name: "Person A" }, { name: "Person B" }], { session });
    expect(bookings.length).toBe(2);
    await session.abortTransaction();
    await session.endSession();
  });
});
