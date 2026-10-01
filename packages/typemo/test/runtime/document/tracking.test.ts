/*
 * Change tracking on the real server: the delta of every kind of change, the exact update
 * recorded by `CommandRecorder` (what the server received), and the state afterwards.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { ObjectId } from "mongodb";
import { CastError, DirectWriteError, type Model, PartialArrayError, QueryError } from "../../../src/index.ts";
import { Order } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("doc_tracking");
let Orders: Model<Order>;
let id: ObjectId;

beforeEach(async () => {
  Orders = t.connection.model(Order);
  const order = await Orders.create({
    customer: "ann",
    tags: ["a", "b", "c"],
    lines: [
      { sku: "x", qty: 1 },
      { sku: "y", qty: 2 },
      { sku: "z", qty: 3 },
    ],
    address: { city: "Paris" },
    notes: { k: "v" },
  });
  id = order._id;
  t.commands.clear();
});

/**
 * Loads the seeded order through the model.
 * @returns The hydrated order.
 */
const load = () => Orders.findById(id).orFail();
/**
 * Reads the seeded order straight from the collection.
 * @returns The stored raw document.
 */
const stored = () => t.mongo.db.collection("d_orders").findOne({ _id: id });

/**
 * The update document of the only `update` command sent (updatedAt left out: it changes every time).
 * @returns The `u` part without `updatedAt`.
 */
const sentUpdate = (): Record<string, unknown> => {
  const updates = t.commands.byName("update");
  expect(updates.length).toBe(1);
  const u = { ...(updates[0]?.command.updates[0].u as Record<string, Record<string, unknown>>) };
  if (u.$set !== undefined) {
    const { updatedAt, ...rest } = u.$set;
    expect(updatedAt).toBeInstanceOf(Date);
    if (Object.keys(rest).length === 0) delete u.$set;
    else u.$set = rest;
  }
  return u;
};
/**
 * The filter of the first `update` command sent.
 * @returns The `q` part of the update.
 */
const sentFilter = () => t.commands.byName("update")[0]?.command.updates[0].q as Record<string, unknown>;

describe("root fields", () => {
  test("a scalar: $set; delete: $unset; $markModified: a whole $set of the field", async () => {
    const order = await load();
    t.commands.clear();
    order.customer = "bob";
    delete (order as { address?: unknown }).address;
    await order.$save();
    expect(sentUpdate()).toEqual({ $set: { customer: "bob" }, $unset: { address: "" } });
    expect(await stored()).not.toHaveProperty("address");
  });

  test("$set of a dotted path goes into the subdocument; a nested field change is $set of its path", async () => {
    const order = await load();
    t.commands.clear();
    order.$set("address.street", "Main");
    await order.$save();
    expect(sentUpdate()).toEqual({ $set: { "address.street": "Main" } });
    expect((await stored())?.address).toEqual({ city: "Paris", street: "Main" });
  });

  test("$set of a whole container replaces it ($set of the field, version incremented)", async () => {
    const order = await load();
    t.commands.clear();
    order.$set("tags", ["q"]);
    await order.$save();
    expect(sentUpdate()).toEqual({ $set: { tags: ["q"] }, $inc: { __v: 1 } });
  });

  test("a container assigned around $set is refused at save (DirectWriteError), nothing sent", async () => {
    const order = await load();
    t.commands.clear();
    (order as { tags: unknown }).tags = ["plain"];
    await expect(order.$save()).rejects.toThrow(DirectWriteError);
    expect(t.commands.all()).toEqual([]);
  });

  test("$markModified forces the field into the update", async () => {
    const order = await load();
    t.commands.clear();
    order.$markModified("address");
    expect(order.$isModified("address.city")).toBe(true);
    await order.$save();
    expect(sentUpdate()).toEqual({ $set: { address: { city: "Paris" } } });
  });

  test("a directly assigned scalar is cast once at save (the setter runs once)", async () => {
    const order = await load();
    t.commands.clear();
    order.code = "MiXeD";
    order.total = 12;
    await order.$save();
    expect(order.code).toBe("mixed");
    expect(order.total).toBe(12);
    expect(sentUpdate()).toEqual({ $set: { code: "mixed", total: 12 } });
  });

  test("a directly assigned scalar that does not cast (no string → number): CastError, nothing sent", async () => {
    const order = await load();
    t.commands.clear();
    (order as { total: unknown }).total = "12";
    await expect(order.$save()).rejects.toThrow(CastError);
    await expect(order.$save()).rejects.toThrow(/^Cast to number failed at path "total"/);
    expect(t.commands.all()).toEqual([]);
  });
});

describe("collections (the journals)", () => {
  test("push / pull / addToSet of a string array", async () => {
    const order = await load();
    t.commands.clear();
    order.tags.pull("b");
    await order.$save();
    expect(sentUpdate()).toEqual({ $pullAll: { tags: ["b"] }, $inc: { __v: 1 } });
    t.commands.clear();
    order.tags.addToSet("a", "d");
    await order.$save();
    expect(sentUpdate()).toEqual({ $addToSet: { tags: { $each: ["d"] } }, $inc: { __v: 1 } });
    expect((await stored())?.tags).toEqual(["a", "c", "d"]);
  });

  test("set(i) is positional: guarded by the version in the filter (7.5)", async () => {
    const order = await load();
    t.commands.clear();
    order.tags.set(1, "B");
    await order.$save();
    expect(sentUpdate()).toEqual({ $set: { "tags.1": "B" } });
    expect(sentFilter()).toEqual({ _id: id, __v: 0 });
    expect((await stored())?.tags).toEqual(["a", "B", "c"]);
  });

  test("a subdocument element's field: $set by its CURRENT index after a pull", async () => {
    const order = await load();
    t.commands.clear();
    const z = order.lines[2];
    order.lines.pull(order.lines[0] as never);
    if (z !== undefined) z.qty = 30;
    await order.$save();
    /* two different operators on one array: the whole array is rewritten */
    const lines = (await stored())?.lines as { sku: string; qty: number }[];
    expect(lines.map((line) => [line.sku, line.qty])).toEqual([
      ["y", 2],
      ["z", 30],
    ]);
  });

  test("Map: set and delete of a key", async () => {
    const order = await load();
    t.commands.clear();
    order.notes?.set("n", "w");
    order.notes?.delete("k");
    await order.$save();
    expect((await stored())?.notes).toEqual({ n: "w" });
  });

  test("the state after a save is clean: a second save sends nothing", async () => {
    const order = await load();
    order.tags.push("x");
    order.lines[0]?.$set("qty", 7);
    await order.$save();
    t.commands.clear();
    await order.$save();
    expect(t.commands.all()).toEqual([]);
    expect(order.$isModified()).toBe(false);
  });
});

describe("what was loaded", () => {
  test("a partially loaded array ($slice) is never rewritten whole: PartialArrayError; atomics are fine", async () => {
    const order = await Orders.findById(id)
      .select({ tags: { $slice: 1 } })
      .orFail();
    expect([...order.tags]).toEqual(["a"]);
    order.tags.set(0, "A");
    await expect(order.$save()).rejects.toThrow(PartialArrayError);
    const again = await Orders.findById(id)
      .select({ tags: { $slice: 1 } })
      .orFail();
    again.tags.push("p");
    await again.$save();
    expect((await stored())?.tags).toEqual(["a", "b", "c", "p"]);
  });

  test("a positional change of a document read without __v: an error, never an unguarded write", async () => {
    const order = await Orders.findById(id).select({ tags: 1 }).orFail();
    order.tags.set(0, "A");
    await expect(order.$save()).rejects.toThrow(QueryError);
    await expect(order.$save()).rejects.toThrow(/read without it/);
  });

  test("a stored document missing a field with a default gets it at load, as a change; a deselected one does not", async () => {
    await t.mongo.db.collection("d_orders").updateOne({ _id: id }, { $unset: { status: "", total: "" } });
    const order = await load();
    expect(order.status).toBe("new");
    expect(order.$isModified("status")).toBe(true);
    t.commands.clear();
    await order.$save();
    expect(sentUpdate()).toEqual({ $set: { total: 0, status: "new" } });
    await t.mongo.db.collection("d_orders").updateOne({ _id: id }, { $unset: { status: "" } });
    const partial = await Orders.findById(id).select({ customer: 1 }).orFail();
    /* cast: the field is not in the projection's type either */
    expect((partial as unknown as { status?: string }).status).toBeUndefined();
    expect(partial.$isModified()).toBe(false);
  });

  test("a NaN stored by another program does not make the document modified; changing it does", async () => {
    await t.mongo.db.collection("d_orders").updateOne({ _id: id }, { $set: { total: Number.NaN } });
    const order = await load();
    expect(Number.isNaN(order.total)).toBe(true);
    expect(order.$isModified()).toBe(false);
    expect(order.$isModified("total")).toBe(false);
    expect(order.$getChanges()).toEqual({});
    order.total = 5;
    expect(order.$isModified("total")).toBe(true);
    expect(order.$getChanges().$set?.total).toBe(5);
  });
});
