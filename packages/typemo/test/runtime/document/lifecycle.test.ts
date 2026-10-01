/*
 * The lifecycle of a hydrated document on the real server: new → save (insert) →
 * change → save (the minimal update, recorded) → empty save (nothing sent) → deleteOne. The document is
 * a REAL instance of the entity class, its state is hidden (no own non-data keys).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { CastError, DocumentNotFoundError, type Model, QueryError } from "../../../src/index.ts";
import { Hooked, HookLog, Line, Order, PlainDoc, SetterLog } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("doc_lifecycle");
let Orders: Model<Order>;

beforeEach(() => {
  Orders = t.connection.model(Order);
  t.commands.clear();
  SetterLog.calls = 0;
  HookLog.lines = [];
});

/**
 * Reads an order straight from the collection.
 * @param id The order id.
 * @returns The stored raw document.
 */
const stored = (id: unknown) => t.mongo.db.collection("d_orders").findOne({ _id: id as ObjectId });

describe("a new document", () => {
  test("model.new(): an instance of the entity class, cast at once, defaults applied, nothing sent", () => {
    const order = Orders.new({ customer: "ann", tags: ["a"], lines: [] });
    expect(order).toBeInstanceOf(Order);
    expect(order.describe()).toBe("order of ann");
    expect(order.label).toBe("ann#1");
    expect(order.$isNew()).toBe(true);
    expect(order._id).toBeInstanceOf(ObjectId);
    expect(order.total).toBe(0);
    expect(order.status).toBe("new");
    expect(order.createdAt).toBeUndefined(); /* timestamps are the save's */
    expect(Object.keys(order).sort()).toEqual(["_id", "customer", "lines", "status", "tags", "total"]);
    expect(t.commands.all()).toEqual([]);
    expect(() => Orders.new({ customer: 5 as never, tags: [], lines: [] })).toThrow(CastError);
    expect(() => Orders.new({ customer: "x", tags: [], lines: [], nope: 1 } as never)).toThrow(/not a field/);
  });

  test("save inserts it once: timestamps and __v = 0 from the core; then it is not new", async () => {
    const order = Orders.new({ customer: "ann", tags: ["a"], lines: [{ sku: "x", qty: 1 }], code: "ABC" });
    expect(SetterLog.calls).toBe(1);
    /* the same instance; its type after $save is the saved one (timestamps and __v no longer optional) */
    expect<object>(await order.$save()).toBe(order);
    expect(SetterLog.calls).toBe(1); /* the setter ran once */
    expect(order.$isNew()).toBe(false);
    expect(order.__v).toBe(0);
    expect(order.createdAt).toBeInstanceOf(Date);
    expect(order.updatedAt).toEqual(order.createdAt);
    const inserts = t.commands.byName("insert");
    expect(inserts.length).toBe(1);
    const doc = await stored(order._id);
    expect(doc).toMatchObject({ customer: "ann", code: "abc", total: 0, status: "new", __v: 0, tags: ["a"] });
    expect((doc?.lines as unknown[] | undefined)?.length).toBe(1);
  });

  test("create() = new + save; create([...]) = one ordered write", async () => {
    const one = await Orders.create({ customer: "ann", tags: [], lines: [] });
    expect(one.$isNew()).toBe(false);
    const many = await Orders.create([
      { customer: "b", tags: [], lines: [] },
      { customer: "c", tags: [], lines: [] },
    ]);
    expect(many.map((order) => order.$isNew())).toEqual([false, false]);
    expect(t.commands.byName("insert").length + t.commands.byName("bulkWrite").length).toBeGreaterThanOrEqual(2);
    expect(await Orders.countDocuments()).toBe(3);
  });
});

describe("an existing document", () => {
  test("a change sends only the changed paths; an empty save sends nothing", async () => {
    const created = await Orders.create({ customer: "ann", tags: ["a"], lines: [] });
    const order = await Orders.findById(created._id).orFail();
    expect(order.$isNew()).toBe(false);
    expect(order.$isModified()).toBe(false);
    t.commands.clear();
    await order.$save();
    expect(t.commands.all()).toEqual([]); /* empty save: no query at all (Mongoose did a findOne) */

    order.customer = "bob";
    order.tags.push("b");
    expect(order.$isModified("customer")).toBe(true);
    expect(order.$isModified("total")).toBe(false);
    await order.$save();
    const [update] = t.commands.byName("update");
    const sent = update?.command.updates[0];
    expect(sent.q).toEqual({ _id: created._id });
    expect(sent.u.$set.customer).toBe("bob");
    expect(sent.u.$set.updatedAt).toBeInstanceOf(Date);
    expect(sent.u.$push).toEqual({ tags: { $each: ["b"] } });
    expect(sent.u.$inc).toEqual({ __v: 1 }); /* a length change increments the version */
    expect(order.__v).toBe(1);
    expect(order.$isModified()).toBe(false);
    expect(await stored(created._id)).toMatchObject({ customer: "bob", tags: ["a", "b"], __v: 1 });
  });

  test("assigning the saved value back is not a change", async () => {
    const order = await Orders.create({ customer: "ann", tags: [], lines: [] });
    order.customer = "zed";
    order.customer = "ann";
    expect(order.$isModified()).toBe(false);
    t.commands.clear();
    await order.$save();
    expect(t.commands.all()).toEqual([]);
  });

  test("a deleted document: save is DocumentNotFoundError (Mongoose did nothing)", async () => {
    const order = await Orders.create({ customer: "ann", tags: [], lines: [] });
    await t.mongo.db.collection("d_orders").deleteOne({ _id: order._id });
    order.customer = "x";
    await expect(order.$save()).rejects.toThrow(DocumentNotFoundError);
  });

  test("$deleteOne: by _id; the document cannot be saved afterwards", async () => {
    const order = await Orders.create({ customer: "ann", tags: [], lines: [] });
    expect((await order.$deleteOne()).deletedCount).toBe(1);
    expect(await Orders.countDocuments()).toBe(0);
    await expect(order.$save()).rejects.toThrow(QueryError);
  });

  test("the version key and the creation time cannot be changed by hand", async () => {
    const order = await Orders.create({ customer: "ann", tags: [], lines: [] });
    expect(() => order.$set("__v" as never, 5 as never)).toThrow(/maintained by the core/);
    (order as { __v: number }).__v = 9;
    await expect(order.$save()).rejects.toThrow(/version key/);
  });

  test("a second save while one is in flight is refused", async () => {
    const order = Orders.new({ customer: "ann", tags: [], lines: [] });
    const first = order.$save();
    await expect(order.$save()).rejects.toThrow(/in flight/);
    await first;
  });
});

describe("hooks and validation order", () => {
  test("pre('save') → pre/post('validate') → write → post('save'); a hook's change is validated and saved", async () => {
    const Hooks = t.connection.model(Hooked);
    const doc = await Hooks.create({ name: "fix-me" });
    expect(HookLog.lines).toEqual(["pre save fix-me", "pre validate fixed", "post validate", "post save fixed"]);
    expect(await t.mongo.db.collection("d_hooked").findOne({ _id: doc._id })).toMatchObject({
      name: "fixed",
      stamp: "stamped",
    });
  });

  test("a hook that breaks the document fails validation: nothing is written, postError runs", async () => {
    const Hooks = t.connection.model(Hooked);
    await expect(Hooks.create({ name: "break-me" })).rejects.toThrow(/invalid name/);
    expect(HookLog.lines.at(-1)).toBe("postError save ValidationError");
    expect(await t.mongo.db.collection("d_hooked").countDocuments()).toBe(0);
  });

  test("no query hook fires for a document write", async () => {
    const Hooks = t.connection.model(Hooked);
    const doc = await Hooks.create({ name: "a" });
    HookLog.lines = [];
    await doc.$deleteOne();
    expect(HookLog.lines).toEqual(["pre deleteOne a"]);
  });
});

describe("the document is the entity instance", () => {
  test("a read document: class, methods, getters; hidden state (keys are data only)", async () => {
    await Orders.create({ customer: "ann", tags: ["x"], lines: [{ sku: "a", qty: 2 }] });
    const order = await Orders.findOne({ customer: "ann" }).orFail();
    expect(order).toBeInstanceOf(Order);
    expect(order.lines[0]).toBeInstanceOf(Line);
    expect(order.label).toBe("ann#1");
    for (const key of Object.keys(order)) expect(key.startsWith("$")).toBe(false);
    expect(JSON.parse(JSON.stringify(order)).customer).toBe("ann");
  });

  test("a schema without service fields saves without them", async () => {
    const Plain = t.connection.model(PlainDoc);
    const doc = await Plain.create({ name: "a" });
    doc.name = "b";
    await doc.$save();
    expect(await t.mongo.db.collection("d_plain").findOne({ _id: doc._id })).toEqual({
      _id: doc._id,
      name: "b",
      tags: [],
    });
  });
});
