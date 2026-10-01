/*
 * The audit policy on the real server — an entry per write on EVERY write path, in the SAME session (rolled
 * back with the transaction), secrets masked by the field option `sensitive: "mask" | "hide"`
 * ("hide" → "[hidden]") in filters, updates and documents, and every scenario where a failed audit write
 * fails the operation: always inside a transaction (its own when the write is called outside one), so a
 * failed audit write leaves nothing applied.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  AuditError,
  BulkWriteError,
  fn,
  type Model,
  PolicyContext,
  SENSITIVE_HIDDEN,
  SENSITIVE_MASK,
} from "../../../src/internal.ts";
import { Note, Payment } from "../../fixtures/mechanisms/mechanism-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("m9_audit");
let Payments: Model<Payment>;
let Notes: Model<Note>;
/**
 * The audit trail collection of `Payment`.
 * @returns The driver collection.
 */
const trail = () => t.mongo.db.collection("m9_payments_trail");
/**
 * The audit trail collection of `Note`.
 * @returns The driver collection.
 */
const notesTrail = () => t.mongo.db.collection("m9_notes_audit");
/**
 * The entries of the payments trail in insertion order.
 * @returns The stored entries.
 */
const entries = async () =>
  trail()
    .find({}, { sort: { _id: 1 } })
    .toArray();

/**
 * Makes every audit write of Payment fail (a validator no entry satisfies: server code 121).
 */
const breakTrail = async (): Promise<void> => {
  await trail()
    .drop()
    .catch(() => undefined);
  await t.mongo.db.createCollection("m9_payments_trail", { validator: { $jsonSchema: { required: ["neverThere"] } } });
};

beforeEach(async () => {
  /* A trail broken by a previous test (its validator) is dropped: collections outlive the per-test cleanup. */
  await trail()
    .drop()
    .catch(() => undefined);
  Payments = t.connection.model(Payment);
  Notes = t.connection.model(Note);
  t.commands.clear();
});

describe("every write leaves one entry (reads none)", () => {
  test("insertOne / insertMany / create / $save / bulkSave / bulkWrite", async () => {
    await Payments.insertOne({ amount: 1 });
    await Payments.insertMany([{ amount: 2 }, { amount: 3 }]);
    const created = await Payments.create({ amount: 4 });
    created.$set("amount", 5);
    await created.$save();
    await Payments.bulkSave([Payments.new({ amount: 6 })]);
    await Payments.bulkWrite([{ insertOne: { document: { amount: 7 } } }, { deleteMany: { filter: { amount: 1 } } }]);
    const all = await entries();
    /* `insertOne` is the write of `create`: a document write. */
    expect(all.map((entry) => [entry.operation, entry.document])).toEqual([
      ["insertOne", true],
      ["insertMany", false],
      ["insertOne", true],
      ["updateOne", true],
      ["bulkWrite", true],
      ["bulkWrite", false],
    ]);
    expect(all[1]?.documents.map((doc: { amount: number }) => doc.amount)).toEqual([2, 3]);
    expect(all[1]?.documents[0]._id).toBeInstanceOf(ObjectId);
    expect(all[3]?.update).toEqual({ $set: { amount: 5 } });
    expect(all[5]?.operations).toEqual([
      { insertOne: { document: expect.objectContaining({ amount: 7 }) } },
      { deleteMany: { filter: { amount: 1 } } },
    ]);
    expect(all[5]?.result).toMatchObject({ insertedCount: 1, deletedCount: 1 });
    expect(all.every((entry) => entry.model === "Payment" && entry.outcome === "ok")).toBe(true);
  });

  test("updates, replaces, deletes, findOneAnd*, a document's $updateOne / $deleteOne; reads none", async () => {
    const doc = await Payments.create({ amount: 10 });
    await trail().deleteMany({});
    await Payments.find();
    await Payments.countDocuments();
    await Payments.updateOne({ _id: doc._id }, { $inc: { amount: 1 } });
    await Payments.updateMany({ amount: { $gt: 0 } }, { $inc: { amount: 1 } });
    await Payments.replaceOne({ _id: doc._id }, { amount: 20 });
    await Payments.findOneAndUpdate({ _id: doc._id }, { $inc: { amount: 1 } });
    await Payments.findOneAndReplace({ _id: doc._id }, { amount: 30 });
    await doc.$updateOne({ $inc: { amount: 1 } });
    await Payments.findOneAndDelete({ _id: doc._id });
    const other = await Payments.create({ amount: 1 });
    await other.$deleteOne();
    const all = await entries();
    expect(all.map((entry) => entry.operation)).toEqual([
      "updateOne",
      "updateMany",
      "replaceOne",
      "findOneAndUpdate",
      "findOneAndReplace",
      "updateOne",
      "findOneAndDelete",
      "insertOne",
      "deleteOne",
    ]);
    expect(all[0]?.result).toEqual({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null });
    expect(all[3]?.result).toEqual({ found: 1, _id: doc._id });
    expect(all[5]?.document).toBe(true); /* $updateOne is a document write */
    expect(all[2]?.replacement).toMatchObject({ amount: 20 });
  });

  test("actor and tenant come from the policy context; a soft delete is recorded as a delete", async () => {
    await PolicyContext.run({ tenant: "t1", actor: { id: "u1" } }, async () => {
      await Notes.create({ title: "n" });
      await Notes.deleteOne({ title: "n" });
    });
    const all = await notesTrail().find().toArray();
    expect(all.map((entry) => [entry.operation, entry.actor, entry.tenant, entry.softDelete ?? false])).toEqual([
      ["insertOne", { id: "u1" }, "t1", false],
      ["deleteOne", { id: "u1" }, "t1", true],
    ]);
    expect(all[1]?.update).toEqual({ $set: { deletedAt: expect.any(Date), updatedAt: expect.any(Date) } });
  });
});

describe("secrets: audit 'mask' | 'omit' everywhere", () => {
  test("documents, filters, updates, $push of subdocuments, replacements, $expr", async () => {
    await PolicyContext.run({ tenant: "t" }, async () => {
      await Notes.insertOne({
        title: "a",
        secret: "s3cr3t",
        internal: "int",
        credentials: [{ kind: "api", token: "tok-1" }],
      });
      await Notes.updateMany(
        { secret: "s3cr3t", internal: "int", title: "a" },
        { $set: { secret: "new", internal: "x", "credentials.0.token": "tok-2" } },
      );
      await Notes.updateOne({ title: "a" }, { $push: { credentials: { kind: "k", token: "tok-3" } } });
      await Notes.replaceOne({ title: "a" }, {
        title: "a",
        secret: "r",
        credentials: [{ kind: "z", token: "tok-4" }],
      } as never);
      await Notes.deleteMany({ $expr: (f) => fn.eq(f.secret, "r") });
    });
    const all = await notesTrail()
      .find({}, { sort: { _id: 1 } })
      .toArray();
    const text = Bun.inspect(all, { depth: 20 });
    for (const secret of ["s3cr3t", "tok-1", "tok-2", "tok-3", "tok-4", '"new"', '"r"', '"int"', '"x"']) {
      expect(text).not.toContain(secret);
    }
    const [insert, update, push, replace, remove] = all;
    expect(insert?.documents[0]).toMatchObject({
      title: "a",
      secret: SENSITIVE_MASK,
      credentials: [{ kind: "api", token: SENSITIVE_MASK }],
    });
    /* a "hide" field keeps its key, the value is the marker */
    expect(insert?.documents[0].internal).toBe(SENSITIVE_HIDDEN);
    expect(update?.filter).toMatchObject({ secret: SENSITIVE_MASK, title: "a", tenantId: "t" });
    expect(update?.filter.internal).toBe(SENSITIVE_HIDDEN);
    expect(update?.update.$set).toMatchObject({ secret: SENSITIVE_MASK, "credentials.0.token": SENSITIVE_MASK });
    expect(update?.update.$set.internal).toBe(SENSITIVE_HIDDEN);
    expect(push?.update.$push.credentials).toEqual({ kind: "k", token: SENSITIVE_MASK });
    expect(replace?.replacement).toMatchObject({
      secret: SENSITIVE_MASK,
      credentials: [{ kind: "z", token: SENSITIVE_MASK }],
    });
    expect(remove?.filter.$expr).toBe(SENSITIVE_MASK);
  });
});

describe("the same session: rolled back with the transaction", () => {
  test("committed: entries written in the transaction (same lsid and txnNumber as the write)", async () => {
    await t.connection.transaction(async () => {
      await Payments.insertOne({ amount: 1 });
    });
    expect((await entries()).length).toBe(1);
    const inserts = t.commands.byName("insert");
    const [write, audit] = inserts;
    expect(audit?.command.insert).toBe("m9_payments_trail");
    expect(audit?.command.lsid).toEqual(write?.command.lsid);
    expect(audit?.command.txnNumber).toEqual(write?.command.txnNumber);
  });

  test("aborted: neither the write nor its entry exists", async () => {
    await expect(
      t.connection.transaction(async () => {
        await Payments.insertOne({ amount: 1 });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await t.mongo.db.collection("m9_payments").countDocuments()).toBe(0);
    expect((await entries()).length).toBe(0);
  });
});

describe("a failed audit write fails the operation and NOTHING is applied — every scenario", () => {
  /*
   * An audited write outside a transaction runs in its own transaction: the write and the entry commit together
   * or not at all (once, some scenarios left the write applied without its entry).
   */
  test("1. a single write outside a transaction: AuditError, applied: false — the write is NOT in the database", async () => {
    await breakTrail();
    const error = await Payments.insertOne({ amount: 1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuditError);
    expect((error as AuditError).applied).toBe(false);
    expect(((error as AuditError).cause as { code?: number }).code).toBe(121);
    expect(await t.mongo.db.collection("m9_payments").countDocuments()).toBe(0);
  });

  test("2. inside a transaction: AuditError, applied: false — the write is rolled back", async () => {
    await breakTrail();
    const error = await t.connection
      .transaction(async () => {
        await Payments.insertOne({ amount: 1 });
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuditError);
    expect((error as AuditError).applied).toBe(false);
    expect(await t.mongo.db.collection("m9_payments").countDocuments()).toBe(0);
  });

  test("3. an unordered insertMany with a duplicate: the server aborts the transaction — nothing written, nothing audited", async () => {
    const id = new ObjectId();
    await Payments.insertOne({ _id: id, amount: 0 } as never);
    await trail().deleteMany({});
    const error = await Payments.insertMany([{ amount: 1 }, { _id: id, amount: 2 } as never, { amount: 3 }], {
      ordered: false,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BulkWriteError);
    expect((error as BulkWriteError).writeErrors.map((failure) => failure.code)).toEqual([11000]);
    expect(await t.mongo.db.collection("m9_payments").countDocuments()).toBe(1);
    expect(await entries()).toEqual([]);
  });

  test("3b. J6 kept: an unordered insertMany with documents refused BEFORE the server commits the valid ones and audits them (partial)", async () => {
    const error = await Payments.insertMany([{ amount: 1 }, { amount: "x" } as never, { amount: 3 }], {
      ordered: false,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BulkWriteError);
    expect((error as BulkWriteError).writeErrors.map((failure) => [failure.index, failure.code])).toEqual([
      [1, undefined],
    ]);
    expect(await t.mongo.db.collection("m9_payments").countDocuments()).toBe(2);
    const [entry] = await entries();
    expect(entry?.outcome).toBe("partial");
    expect(entry?.documents.map((doc: { amount: number }) => doc.amount)).toEqual([1, 3]);
  });

  test("4. the same (refused before the server) with the audit failing: AuditError, NOTHING written", async () => {
    await breakTrail();
    const error = await Payments.insertMany([{ amount: 1 }, { amount: "x" } as never], { ordered: false }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AuditError);
    expect((error as AuditError).applied).toBe(false);
    expect((error as AuditError).operationError).toBeInstanceOf(BulkWriteError);
    expect(await t.mongo.db.collection("m9_payments").countDocuments()).toBe(0);
  });

  test("5. $save of a new document: AuditError; not in the database, still new in memory — a second $save inserts it", async () => {
    await breakTrail();
    const doc = Payments.new({ amount: 9 });
    await expect(doc.$save()).rejects.toBeInstanceOf(AuditError);
    expect(doc.$isNew()).toBe(true);
    expect(await t.mongo.db.collection("m9_payments").countDocuments({ amount: 9 })).toBe(0);
    await trail().drop();
    await doc.$save(); /* no E11000: the first insert was rolled back */
    expect(doc.$isNew()).toBe(false);
    expect(await t.mongo.db.collection("m9_payments").countDocuments({ amount: 9 })).toBe(1);
    expect((await entries()).map((entry) => entry.operation)).toEqual(["insertOne"]);
  });

  test("5b. $save of an existing document: AuditError; the database unchanged, the change still pending — sent again", async () => {
    const doc = await Payments.create({ amount: 1 });
    await breakTrail();
    doc.$set("amount", 2);
    await expect(doc.$save()).rejects.toBeInstanceOf(AuditError);
    expect((await t.mongo.db.collection("m9_payments").findOne({ _id: doc._id }))?.amount).toBe(1);
    expect(doc.$isModified("amount")).toBe(true);
    await trail().drop();
    await doc.$save();
    expect((await t.mongo.db.collection("m9_payments").findOne({ _id: doc._id }))?.amount).toBe(2);
  });

  test("6. an update / delete / soft delete outside a transaction: AuditError, not applied", async () => {
    const doc = await Payments.create({ amount: 1 });
    await breakTrail();
    await expect(Payments.updateOne({ _id: doc._id }, { $set: { amount: 2 } }).exec()).rejects.toBeInstanceOf(
      AuditError,
    );
    expect((await t.mongo.db.collection("m9_payments").findOne({ _id: doc._id }))?.amount).toBe(1);
    await expect(Payments.deleteOne({ _id: doc._id }).exec()).rejects.toBeInstanceOf(AuditError);
    expect(await t.mongo.db.collection("m9_payments").countDocuments({ _id: doc._id })).toBe(1);
    /* Soft delete (Note: tenant + soft delete + audit): the delete date is not set. */
    await PolicyContext.run({ tenant: "t" }, async () => {
      await Notes.create({ title: "soft" });
    });
    await notesTrail()
      .drop()
      .catch(() => undefined);
    await t.mongo.db.createCollection("m9_notes_audit", { validator: { $jsonSchema: { required: ["neverThere"] } } });
    try {
      await PolicyContext.run({ tenant: "t" }, async () => {
        await expect(Notes.deleteOne({ title: "soft" }).exec()).rejects.toBeInstanceOf(AuditError);
      });
      expect((await t.mongo.db.collection("m9_notes").findOne({ title: "soft" }))?.deletedAt).toBeNull();
    } finally {
      await notesTrail().drop();
    }
  });
});
