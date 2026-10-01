/*
 * Regressions of research/mongoose/M11-history/history.yaml, area `document`: each test is the
 * `how_to_test` of the entry, on the real server, through Typemo's documents.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { ObjectId } from "mongodb";
import { type Model, QueryError, StrictModeError } from "../../../src/index.ts";
import { Order } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("reg_document");
let Orders: Model<Order>;
let id: ObjectId;

beforeEach(async () => {
  Orders = t.connection.model(Order);
  const order = await Orders.create({
    customer: "ann",
    tags: ["a"],
    lines: [
      { sku: "x", qty: 1 },
      { sku: "y", qty: 2 },
      { sku: "z", qty: 3 },
    ],
    address: { city: "Paris" },
    notes: { k: "v" },
    discount: 2.6,
  });
  id = order._id;
  t.commands.clear();
});

const load = () => Orders.findById(id).orFail();
const stored = () => t.mongo.db.collection("d_orders").findOne({ _id: id });
const lastUpdate = () =>
  t.commands.byName("update").at(-1)?.command.updates[0].u as Record<string, Record<string, unknown>>;

describe("history: document", () => {
  test("H023: unknown fields of a stored document are never saved back nor serialized", async () => {
    await t.mongo.db.collection("d_orders").updateOne({ _id: id }, { $set: { legacy: 1 } });
    const order = await load();
    order.customer = "bob";
    await order.$save();
    expect(Object.keys(lastUpdate().$set ?? {})).not.toContain("legacy");
    expect(order.$toObject()).not.toHaveProperty("legacy");
  });

  test("H029: after pull, a change of an element is written to THAT element (index derived at save)", async () => {
    const order = await load();
    const z = order.lines[2];
    order.lines.pull(order.lines[0] as never);
    await order.$save();
    z?.$set("qty", 33);
    await order.$save();
    const lines = (await stored())?.lines as { sku: string; qty: number }[];
    expect(lines.find((line) => line.sku === "z")?.qty).toBe(33);
    expect(lines.find((line) => line.sku === "y")?.qty).toBe(2);
  });

  test("H038: a changed subpath and then the parent removed: only $unset (no path conflict)", async () => {
    const order = await load();
    order.$set("address.street", "Main");
    delete (order as { address?: unknown }).address;
    await order.$save();
    expect(lastUpdate()).toEqual({ $unset: { address: "" }, $set: { updatedAt: expect.any(Date) } });
  });

  test("H115: a changed Map key and then the Map removed: only $unset", async () => {
    const order = await load();
    order.notes?.set("n", "w");
    delete (order as { notes?: unknown }).notes;
    await order.$save();
    expect(lastUpdate().$unset).toEqual({ notes: "" });
    expect((await stored())?.notes).toBeUndefined();
  });

  test("H310: getters are never applied when saving (the stored value is the value)", async () => {
    const order = await load();
    expect(order.$get("discount")).toBe(3);
    order.customer = "bob";
    await order.$save();
    expect((await stored())?.discount).toBe(2.6);
  });

  test("H316: a stored __proto__ key does not pollute prototypes", () => {
    const raw = JSON.parse('{"customer":"a","tags":[],"lines":[],"__proto__":{"polluted":true}}') as Record<
      string,
      unknown
    >;
    const order = Orders.hydrate({ _id: id, ...raw });
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(order)).not.toEqual({ polluted: true });
    expect(order).toBeInstanceOf(Order);
  });

  test("H330/H074: save without changes sends nothing (no findOne, no findOne hooks)", async () => {
    const order = await load();
    t.commands.clear();
    await order.$save();
    expect(t.commands.all()).toEqual([]);
  });

  test("H413: createdAt cannot be overwritten (immutable service field)", async () => {
    const order = await load();
    expect(() => order.$set("createdAt" as never, new Date(0) as never)).toThrow(QueryError);
    (order as { createdAt: Date }).createdAt = new Date(0);
    await expect(order.$save()).rejects.toThrow(StrictModeError);
    expect(((await stored())?.createdAt as Date | undefined)?.getTime()).not.toBe(0);
  });

  test("H421: the stored key order follows the schema, not the input", async () => {
    const created = await Orders.create({ tags: [], lines: [], customer: "z", status: "paid" });
    const keys = Object.keys((await t.mongo.db.collection("d_orders").findOne({ _id: created._id })) ?? {});
    expect(keys.indexOf("customer")).toBeLessThan(keys.indexOf("tags"));
    expect(keys.indexOf("tags")).toBeLessThan(keys.indexOf("status"));
  });

  test("H445: defaults are never applied to fields a projection left out", async () => {
    await t.mongo.db.collection("d_orders").updateOne({ _id: id }, { $unset: { status: "" } });
    const order = await Orders.findById(id).select({ customer: 1 }).orFail();
    order.customer = "bob";
    await order.$save();
    expect(Object.keys(lastUpdate().$set ?? {})).not.toContain("status");
    expect((await stored())?.status).toBeUndefined();
  });

  test("H500: a change made while the save is in flight stays a change", async () => {
    const order = await load();
    order.customer = "one";
    // The change happens when the write has started (after the document's state was taken for it).
    const subscription = t.client.instrument({
      handle: (event) => {
        if (event.type === "operation.start" && event.operation === "updateOne") order.customer = "two";
      },
    });
    try {
      await order.$save();
    } finally {
      subscription.unsubscribe();
    }
    expect((await stored())?.customer).toBe("one");
    expect(order.$isModified("customer")).toBe(true);
    await order.$save();
    expect((await stored())?.customer).toBe("two");
  });

  test("H501: a value equal to the saved one sends no $set", async () => {
    const order = await load();
    order.customer = "ann";
    order.$set("tags", ["a"]);
    await order.$save();
    expect(t.commands.byName("update")).toEqual([]);
  });

  test("H503: a dotted path into a field that was not loaded is refused, never a rewrite of the whole array", async () => {
    const order = await Orders.findById(id).select({ customer: 1 }).orFail();
    // the projection's type has no `lines` (the compiler refuses the path); a cast gets past it at run time:
    expect(() => order.$set("lines.0.qty" as never, 9 as never)).toThrow(/absent/);
    expect(((await stored())?.lines as unknown[] | undefined)?.length).toBe(3);
  });

  test("H506: saving a document deleted in the database is an error", async () => {
    const order = await load();
    await t.mongo.db.collection("d_orders").deleteOne({ _id: id });
    order.customer = "bob";
    await expect(order.$save()).rejects.toThrow(/save/);
  });

  test("H513: a positional change after a concurrent removal is refused (version), not written elsewhere", async () => {
    const mine = await load();
    const theirs = await load();
    theirs.lines.pull(theirs.lines[0] as never);
    await theirs.$save();
    mine.lines[1]?.$set("qty", 20); // "y" for me; index 1 is now "z"
    await expect(mine.$save()).rejects.toThrow(/version/);
    const lines = (await stored())?.lines as { sku: string; qty: number }[];
    expect(lines.map((line) => line.qty)).toEqual([2, 3]);
  });
});
