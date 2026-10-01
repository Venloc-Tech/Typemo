/*
 * Ported from mongoose test/docs/transactions.test.js onto Typemo (rollback between retries):
 * documents saved (or deleted) in a failed attempt are restored before the callback runs again.
 * Mongoose throws a raw `MongoServerError` with the `TransientTransactionError` label from the callback;
 * the same works here (`transaction()` hands the driver's error to `withTransaction`).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { MongoServerError } from "mongodb";
import { Entity, type Model, Prop, Schema } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema({ collection: "p_txn_tests" })
class TxnTest extends Entity {
  @Prop(() => String)
  name?: string;
}

@Schema()
class SubItem {
  @Prop(() => String, { required: true })
  name!: string;
}

@Schema()
class Item {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => [SubItem], { required: true })
  subItems!: SubItem[];
}

@Schema({ collection: "p_txn_items" })
class WithItems extends Entity {
  @Prop(() => [Item], { required: true })
  items!: Item[];
}

const t = ModelLifecycle.useTypemo("ported_txn");
let Tests: Model<TxnTest>;

const transient = () => new MongoServerError({ message: "transient", errorLabels: ["TransientTransactionError"] });

beforeEach(async () => {
  Tests = t.connection.model(TxnTest);
  await Tests.createCollection();
  await t.connection.model(WithItems).createCollection();
});

describe("transactions (ported)", () => {
  // ported from mongoose test/docs/transactions.test.js:445 "transaction() resets $isNew on error"
  test("transaction() resets $isNew on error", async () => {
    const doc = Tests.new({ name: "test" });
    expect(doc.$isNew()).toBe(true);
    await expect(
      t.connection.transaction(async (scope) => {
        await doc.$save({ session: scope.session });
        throw new Error("Oops!");
      }),
    ).rejects.toThrow(/Oops!/);
    expect(doc.$isNew()).toBe(true);
    expect(await Tests.exists({ _id: doc._id })).toBeNull();
  });

  // ported from mongoose test/docs/transactions.test.js:466 "transaction() resets $isNew between retries (gh-13698)"
  test("transaction() resets $isNew between retries (gh-13698)", async () => {
    const doc = Tests.new({ name: "test" });
    let retryCount = 0;
    await t.connection.transaction(async (scope) => {
      expect(doc.$isNew()).toBe(true);
      await doc.$save({ session: scope.session });
      if (++retryCount < 3) throw transient();
    });
    const docs = await Tests.find();
    expect(docs.length).toBe(1);
    expect(docs[0]?.name).toBe("test");
  });

  // ported from mongoose test/docs/transactions.test.js:490 "transaction() resets $isDeleted between retries"
  // (Typemo has no public $isDeleted: a document still marked deleted would refuse the second $deleteOne)
  test("transaction() resets the deleted state between retries", async () => {
    const doc = await Tests.create({ name: "test" });
    let retryCount = 0;
    await t.connection.transaction(async (scope) => {
      await doc.$deleteOne({ session: scope.session });
      if (++retryCount < 2) throw transient();
    });
    expect(retryCount).toBe(2);
    expect(await Tests.exists({ _id: doc._id })).toBeNull();
  });

  // ported from mongoose test/docs/transactions.test.js:523 "handles resetting array state with $set atomic (gh-13698)"
  test("handles resetting array state with $set atomic (gh-13698)", async () => {
    const Items = t.connection.model(WithItems);
    const { _id } = await Items.create({
      items: [
        { name: "test1", subItems: [{ name: "x1" }] },
        { name: "test2", subItems: [{ name: "x2" }] },
      ],
    });
    const doc = await Items.findById(_id).orFail();
    let attempt = 0;
    const res = await t.connection.transaction(async (scope) => {
      await doc.$save({ session: scope.session });
      if (attempt === 0) {
        attempt += 1;
        throw transient();
      }
      return { answer: 42 };
    });
    expect(res).toEqual({ answer: 42 });
    const { items } = await Items.findById(_id).orFail();
    expect(items.length).toBe(2);
    expect(items[0]?.name).toBe("test1");
    expect(items[0]?.subItems.length).toBe(1);
    expect(items[0]?.subItems[0]?.name).toBe("x1");
    expect(items[1]?.name).toBe("test2");
    expect(items[1]?.subItems[0]?.name).toBe("x2");
  });

  // ported from mongoose test/docs/transactions.test.js:582 "transaction() resets $isNew between retries with bulkSave() (gh-16432)"
  test("transaction() resets $isNew between retries with bulkSave() (gh-16432)", async () => {
    const doc = Tests.new({ name: "test" });
    let retryCount = 0;
    await t.connection.transaction(async (scope) => {
      expect(doc.$isNew()).toBe(true);
      await Tests.bulkSave([doc], { session: scope.session });
      if (++retryCount < 3) throw transient();
    });
    const docs = await Tests.find();
    expect(docs.length).toBe(1);
    expect(docs[0]?.name).toBe("test");
  });

  // ported from mongoose test/docs/transactions.test.js:605 "transaction() restores modified paths between retries with bulkSave() (gh-16432)"
  test("transaction() restores modified paths between retries with bulkSave() (gh-16432)", async () => {
    const { _id } = await Tests.create({ name: "initial" });
    const doc = await Tests.findById(_id).orFail();
    let retryCount = 0;
    await t.connection.transaction(async (scope) => {
      doc.name = "updated";
      await Tests.bulkSave([doc], { session: scope.session });
      if (++retryCount < 3) throw transient();
    });
    expect((await Tests.findById(_id).orFail()).name).toBe("updated");
  });
});
