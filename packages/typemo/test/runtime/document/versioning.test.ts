/*
 * Version conflicts on the real server (positional protection and full optimistic
 * concurrency), the shard key as read, and bulkSave through the same preparation as save.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { DocumentNotFoundError, type Model, ValidationError, VersionError } from "../../../src/index.ts";
import { Ledger, Order, Tenanted, ValidatorLog } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("doc_versioning");
let Orders: Model<Order>;
let Ledgers: Model<Ledger>;

beforeEach(() => {
  Orders = t.connection.model(Order);
  Ledgers = t.connection.model(Ledger);
  ValidatorLog.calls = [];
  t.commands.clear();
});

describe("positional protection (the default of Versioned)", () => {
  test("a positional write after a concurrent removal is a VersionError, not a write to another element", async () => {
    const order = await Orders.create({ customer: "ann", tags: ["a", "b", "c"], lines: [] });
    const mine = await Orders.findById(order._id).orFail();
    const theirs = await Orders.findById(order._id).orFail();
    theirs.tags.pull("a");
    await theirs.$save(); /* __v 0 → 1 */
    mine.tags.set(1, "B"); /* meant "b"; after the removal index 1 is "c" */
    const error = await mine.$save().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VersionError);
    expect((error as VersionError).version).toBe(0);
    expect((error as VersionError).modifiedPaths).toContain("tags.1");
    expect((await t.mongo.db.collection("d_orders").findOne({ _id: order._id }))?.tags).toEqual(["b", "c"]);
  });

  test("a scalar change is not versioned: concurrent scalar saves both apply", async () => {
    const order = await Orders.create({ customer: "ann", tags: [], lines: [] });
    const a = await Orders.findById(order._id).orFail();
    const b = await Orders.findById(order._id).orFail();
    a.customer = "a";
    await a.$save();
    b.total = 5;
    await b.$save();
    expect(await t.mongo.db.collection("d_orders").findOne({ _id: order._id })).toMatchObject({
      customer: "a",
      total: 5,
    });
  });

  test("a versioned save of a deleted document: DocumentNotFoundError (one read tells it from a conflict)", async () => {
    const order = await Orders.create({ customer: "ann", tags: ["a"], lines: [] });
    await t.mongo.db.collection("d_orders").deleteOne({ _id: order._id });
    order.tags.set(0, "x");
    await expect(order.$save()).rejects.toThrow(DocumentNotFoundError);
  });
});

describe("optimisticConcurrency: every change is conditional and increments the version", () => {
  test("the second of two concurrent saves is a VersionError", async () => {
    const ledger = await Ledgers.create({ owner: "ann", balance: 10 });
    const a = await Ledgers.findById(ledger._id).orFail();
    const b = await Ledgers.findById(ledger._id).orFail();
    a.balance = 20;
    await a.$save();
    expect(a.__v).toBe(1);
    const sent = t.commands.byName("update").at(-1)?.command.updates[0];
    expect(sent.q).toEqual({ _id: ledger._id, __v: 0 });
    expect(sent.u.$inc).toEqual({ __v: 1 });
    b.balance = 30;
    await expect(b.$save()).rejects.toThrow(VersionError);
    expect((await t.mongo.db.collection("d_ledgers").findOne({ _id: ledger._id }))?.balance).toBe(20);
  });

  test("an empty save sends nothing even with optimisticConcurrency (unlike Mongoose)", async () => {
    const ledger = await Ledgers.create({ owner: "ann", balance: 10 });
    t.commands.clear();
    await ledger.$save();
    expect(t.commands.all()).toEqual([]);
  });
});

describe("shard key: the filter carries the ORIGINAL value", () => {
  test("a changed shard key field is still found by its value as read", async () => {
    const Tenants = t.connection.model(Tenanted);
    const doc = await Tenants.create({ region: "eu", name: "a" });
    doc.region = "us";
    await doc.$save();
    const sent = t.commands.byName("update").at(-1)?.command.updates[0];
    expect(sent.q).toEqual({ _id: doc._id, region: "eu" });
    expect(sent.u.$set).toEqual({ region: "us" });
    doc.name = "b";
    await doc.$save();
    expect(t.commands.byName("update").at(-1)?.command.updates[0].q).toEqual({ _id: doc._id, region: "us" });
  });
});

describe("bulkSave", () => {
  test("new and changed documents in ONE ordered write; unchanged ones send nothing; async validators run", async () => {
    const existing = await Orders.create({ customer: "old", tags: [], lines: [] });
    const unchanged = await Orders.create({ customer: "same", tags: [], lines: [] });
    ValidatorLog.calls = [];
    t.commands.clear();
    existing.customer = "changed";
    const fresh = Orders.new({ customer: "new", tags: ["x"], lines: [] });
    const result = await Orders.bulkSave([existing, unchanged, fresh]);
    expect(result?.insertedCount).toBe(1);
    expect(result?.modifiedCount).toBe(1);
    expect(ValidatorLog.calls.sort()).toEqual(["changed", "new"]);
    expect(fresh.$isNew()).toBe(false);
    expect(existing.$isModified()).toBe(false);
    expect(t.commands.all().filter((command) => ["insert", "update"].includes(command.commandName)).length).toBe(2);
    expect(await Orders.countDocuments()).toBe(3);
  });

  test("an invalid document stops the bulk before anything is sent (async validator)", async () => {
    const good = Orders.new({ customer: "good", tags: [], lines: [] });
    const bad = Orders.new({ customer: "forbidden", tags: [], lines: [] });
    await expect(Orders.bulkSave([good, bad])).rejects.toThrow(ValidationError);
    expect(await Orders.countDocuments()).toBe(0);
  });

  test("nothing to write: no request", async () => {
    const doc = await Orders.create({ customer: "a", tags: [], lines: [] });
    t.commands.clear();
    expect(await Orders.bulkSave([doc])).toBeUndefined();
    expect(t.commands.all()).toEqual([]);
  });

  test("a version conflict in the bulk: VersionError (never a silent partial success); the other documents are committed", async () => {
    const one = await Orders.create({ customer: "one", tags: ["a"], lines: [] });
    const two = await Orders.create({ customer: "two", tags: ["a"], lines: [] });
    const stale = await Orders.findById(two._id).orFail();
    const fresh = await Orders.findById(two._id).orFail();
    fresh.tags.push("b");
    await fresh.$save();
    one.customer = "uno";
    stale.tags.set(0, "z");
    await expect(Orders.bulkSave([one, stale])).rejects.toThrow(VersionError);
    expect(one.$isModified()).toBe(false);
    expect(stale.$isModified()).toBe(true);
  });

  test("bulkSave of the shard-keyed model filters by the original value", async () => {
    const Tenants = t.connection.model(Tenanted);
    const doc = await Tenants.create({ region: "eu", name: "a" });
    doc.region = "us";
    t.commands.clear();
    await Tenants.bulkSave([doc]);
    expect(t.commands.byName("update")[0]?.command.updates[0].q).toEqual({ _id: doc._id, region: "eu" });
  });
});
