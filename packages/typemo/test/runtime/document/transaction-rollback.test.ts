/*
 * Transaction retry rollback on the real server: documents enlist in the attempt of
 * the ambient transaction; a failpoint-forced TransientTransactionError makes `withTransaction` run the
 * callback again, and every document saved in the failed attempt is exactly as before its save: `isNew`,
 * the version, the changes (baseline) and the journals of its collections.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type FailPointHandle, FailPointHelpers } from "@venloc/typemo-test-kit";
import { type Model, ServerError } from "../../../src/index.ts";
import { Order, PlainDoc } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("doc_txn");
let failpoint: FailPointHandle | undefined;
let Orders: Model<Order>;
let Plains: Model<PlainDoc>;

beforeEach(async () => {
  Orders = t.connection.model(Order);
  Plains = t.connection.model(PlainDoc);
  await Orders.createCollection();
  await Plains.createCollection();
  t.commands.clear();
});

afterEach(async () => {
  await failpoint?.disable();
  failpoint = undefined;
});

/**
 * Makes the next matching command fail once with a TransientTransactionError.
 * @param command The command to fail.
 */
const transient = async (command: string) => {
  failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
    failCommands: [command],
    errorCode: 112,
    errorLabels: ["TransientTransactionError"],
    times: 1,
  });
};

describe("rollback between attempts", () => {
  test("a NEW document inserted in the failed attempt is new again on retry: inserted once", async () => {
    const order = Orders.new({ customer: "ann", tags: ["a"], lines: [] });
    await transient("update");
    const seen: boolean[] = [];
    await t.connection.transaction(async () => {
      seen.push(order.$isNew());
      await order.$save(); /* attempt 1: inserted (in the transaction)… */
      await Plains.updateOne({ name: "x" }, { $set: { name: "y" } }); /* …then the attempt fails */
    });
    expect(seen).toEqual([true, true]);
    expect(order.$isNew()).toBe(false);
    expect(order.__v).toBe(0);
    expect(await Orders.countDocuments()).toBe(1);
  });

  test("an EXISTING document: its changes and journals come back, the retry sends the same update once", async () => {
    const order = await Orders.create({ customer: "ann", tags: ["a"], lines: [{ sku: "x", qty: 1 }] });
    order.tags.push("b");
    order.lines[0]?.$set("qty", 5);
    order.customer = "bob";
    await transient("commitTransaction");
    let runs = 0;
    await t.connection.transaction(async () => {
      runs++;
      expect(order.$isModified("tags")).toBe(true);
      expect(order.__v).toBe(0);
      await order.$save();
    });
    expect(runs).toBe(2);
    expect(order.__v).toBe(1);
    expect(order.$isModified()).toBe(false);
    const stored = await t.mongo.db.collection("d_orders").findOne({ _id: order._id });
    expect(stored).toMatchObject({ customer: "bob", tags: ["a", "b"], __v: 1 });
    expect((stored?.lines as { qty: number }[] | undefined)?.[0]?.qty).toBe(5);
  });

  test("a failure for good (not transient): the document is restored (onAbort), still modified", async () => {
    const order = await Orders.create({ customer: "ann", tags: [], lines: [] });
    order.customer = "bob";
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["commitTransaction"],
      errorCode: 2 /* BadValue: not transient */,
      times: 1,
    });
    const error = await t.connection
      .transaction(async () => {
        await order.$save();
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServerError);
    expect(order.$isModified("customer")).toBe(true);
    expect((await t.mongo.db.collection("d_orders").findOne({ _id: order._id }))?.customer).toBe("ann");
    await order.$save(); /* outside: the change is still there and goes out now */
    expect((await t.mongo.db.collection("d_orders").findOne({ _id: order._id }))?.customer).toBe("bob");
  });

  test("a document saved twice in one attempt enlists once (the state before its FIRST save comes back)", async () => {
    const order = Orders.new({ customer: "ann", tags: [], lines: [] });
    await transient("commitTransaction");
    const seen: boolean[] = [];
    await t.connection.transaction(async () => {
      seen.push(order.$isNew());
      await order.$save();
      order.customer = "bob";
      await order.$save();
    });
    expect(seen).toEqual([true, true]);
    expect((await t.mongo.db.collection("d_orders").findOne({ _id: order._id }))?.customer).toBe("bob");
    expect(await Orders.countDocuments()).toBe(1);
  });
});
