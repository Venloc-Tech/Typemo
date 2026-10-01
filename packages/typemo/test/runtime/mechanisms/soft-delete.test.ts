/*
 * The soft delete policy across every operation, on the real server. A delete is
 * an update of the delete date; every other operation sees only live documents unless the context says
 * `includeDeleted`/`onlyDeleted`; a user condition on the delete date is never replaced (the old wrapper's bug);
 * `SoftDelete.restore`/`purge`; the unique-index hint.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  ConfigurationError,
  DuplicateKeyError,
  type Model,
  ModelInternals,
  SoftDelete,
  SoftDeletePolicy,
} from "../../../src/internal.ts";
import { Account9, Folder, Label, Note } from "../../fixtures/mechanisms/mechanism-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("m9_soft");
let Accounts: Model<Account9>;
let Notes: Model<Note>;
/**
 * The raw accounts collection.
 * @returns The driver collection.
 */
const raw = () => t.mongo.db.collection("m9_accounts");
const past = new Date("2020-01-01T00:00:00Z");
const ids = { ann: new ObjectId(), bob: new ObjectId(), gone: new ObjectId(), legacy: new ObjectId() };

beforeEach(async () => {
  Accounts = t.connection.model(Account9);
  Notes = t.connection.model(Note);
  t.connection.model(Folder); /* registered: a join and populate target */
  await raw().insertMany([
    { _id: ids.ann, email: "ann@x", removedAt: null },
    { _id: ids.bob, email: "bob@x", removedAt: null },
    { _id: ids.gone, email: "gone@x", removedAt: past },
    { _id: ids.legacy, email: "legacy@x" } /* no field at all: live */,
  ]);
  t.commands.clear();
});

/**
 * The sorted emails of some accounts.
 * @param docs The accounts.
 * @returns The emails in alphabetical order.
 */
const emails = (docs: readonly { readonly email: string }[]) => docs.map((doc) => doc.email).sort();

describe("reads see live documents only", () => {
  test("find / findOne / count / distinct / aggregate / cursor", async () => {
    expect(emails(await Accounts.find().lean())).toEqual(["ann@x", "bob@x", "legacy@x"]);
    expect(await Accounts.findById(ids.gone)).toBeNull();
    expect(await Accounts.countDocuments()).toBe(3);
    expect((await Accounts.distinct("email")).sort()).toEqual(["ann@x", "bob@x", "legacy@x"]);
    const rows = await Accounts.aggregate((p) => p.project({ email: 1 }));
    expect(rows.length).toBe(3);
    const seen: string[] = [];
    for await (const doc of Accounts.find().cursor()) seen.push(doc.email);
    expect(seen.length).toBe(3);
  });

  test("includeDeleted / onlyDeleted", async () => {
    expect((await Accounts.find().policy({ includeDeleted: true }).lean()).length).toBe(4);
    expect(emails(await Accounts.find().policy({ onlyDeleted: true }).lean())).toEqual(["gone@x"]);
    expect(await Accounts.countDocuments().policy({ onlyDeleted: true })).toBe(1);
    const rows = await Accounts.aggregate((p) => p.project({ email: 1 }), { policy: { onlyDeleted: true } });
    expect(rows.length).toBe(1);
  });

  test("a user condition on the delete date is kept, AND the policy's ($and — never replaced)", async () => {
    /* Asking for deleted documents without the context finds nothing (both must hold). */
    expect(await Accounts.find({ removedAt: { $ne: null } }).lean()).toEqual([]);
    const sent = t.commands.byName("find").at(-1)?.command.filter as Record<string, unknown>;
    expect(sent).toEqual({ $and: [{ removedAt: { $ne: null } }, { removedAt: null }] });
    /* With onlyDeleted, a user date range narrows the deleted ones. */
    const old = await Accounts.find({ removedAt: { $lt: new Date("2021-01-01") } })
      .policy({ onlyDeleted: true })
      .lean();
    expect(emails(old)).toEqual(["gone@x"]);
  });

  test("estimatedDocumentCount counts deleted documents: refused unless includeDeleted", async () => {
    await expect(Accounts.estimatedDocumentCount().exec()).rejects.toMatchObject({ reason: "soft-delete" });
    expect(await Accounts.estimatedDocumentCount().policy({ includeDeleted: true })).toBe(4);
  });
});

describe("a delete is an update of the delete date", () => {
  test("deleteOne / deleteMany: the documents stay, marked; the result is a delete's", async () => {
    const one = await Accounts.deleteOne({ email: "ann@x" });
    expect(one).toEqual({ acknowledged: true, deletedCount: 1 });
    const stored = await raw().findOne({ _id: ids.ann });
    expect(stored?.removedAt).toBeInstanceOf(Date);
    const many = await Accounts.deleteMany({ email: { $in: ["bob@x", "gone@x"] } });
    expect(many.deletedCount).toBe(1); /* gone@x was deleted already: not deleted again */
    expect(await raw().countDocuments()).toBe(4);
    expect((await raw().findOne({ _id: ids.gone }))?.removedAt).toEqual(past); /* its date is kept */
    const updates = t.commands.byName("update");
    expect(updates.length).toBe(2);
    expect(t.commands.byName("delete").length).toBe(0);
  });

  test("findOneAndDelete returns the document as it was, and marks it", async () => {
    const doc = await Accounts.findOneAndDelete({ email: "bob@x" }).lean();
    expect(doc?.removedAt).toBeNull();
    expect((await raw().findOne({ _id: ids.bob }))?.removedAt).toBeInstanceOf(Date);
    expect(await Accounts.findById(ids.bob)).toBeNull();
  });

  test("bulkWrite deletes are updates; a document's $deleteOne too", async () => {
    await Accounts.bulkWrite([
      { deleteOne: { filter: { email: "ann@x" } } },
      { deleteMany: { filter: { email: "bob@x" } } },
    ]);
    expect(await raw().countDocuments({ removedAt: { $type: "date" } })).toBe(3);
    const legacy = await Accounts.findById(ids.legacy).orFail();
    const result = await legacy.$deleteOne();
    expect(result.deletedCount).toBe(1);
    expect((await raw().findOne({ _id: ids.legacy }))?.removedAt).toBeInstanceOf(Date);
  });

  test("updates and replaces touch live documents only", async () => {
    const result = await Accounts.updateMany({ email: { $exists: true } }, { $set: { email: "same" } });
    expect(result.matchedCount).toBe(3);
    expect((await raw().findOne({ _id: ids.gone }))?.email).toBe("gone@x");
  });
});

describe("inserts, restore, purge", () => {
  test("inserts store deletedAt: null (the partial unique index can tell live documents)", async () => {
    const created = await Accounts.create({ email: "new@x" });
    expect(created.removedAt).toBeNull();
    await Accounts.insertMany([{ email: "m1@x" }]);
    expect((await raw().findOne({ email: "m1@x" }))?.removedAt).toBeNull();
  });

  test("SoftDelete.restore brings deleted documents back; SoftDelete.purge removes deleted ones for good", async () => {
    const restored = await SoftDelete.restore(Accounts, { email: "gone@x" });
    expect(restored.modifiedCount).toBe(1);
    expect(await Accounts.findById(ids.gone)).not.toBeNull();
    await Accounts.deleteOne({ email: "ann@x" });
    /* purge never removes a live document, even when the filter matches it */
    const purged = await SoftDelete.purge(Accounts, { email: { $in: ["ann@x", "bob@x"] } });
    expect(purged.deletedCount).toBe(1);
    expect(await raw().countDocuments({ _id: ids.ann })).toBe(0);
    expect(await raw().countDocuments({ _id: ids.bob })).toBe(1);
  });

  test("restore/purge of a model without soft delete: ConfigurationError", () => {
    expect(() => SoftDelete.restore(t.connection.model(Label) as never, {})).toThrow(ConfigurationError);
  });
});

describe("joins, populate and indexes", () => {
  test("$lookup and populate never show deleted documents (includeDeleted is about the model's own)", async () => {
    const live = new ObjectId();
    const deleted = new ObjectId();
    await t.mongo.db.collection("m9_folders").insertMany([
      { _id: live, tenantId: "t", name: "live", deletedAt: null },
      { _id: deleted, tenantId: "t", name: "deleted", deletedAt: past },
    ]);
    await t.mongo.db.collection("m9_notes").insertMany([
      { tenantId: "t", title: "one", folder: live, deletedAt: null },
      { tenantId: "t", title: "two", folder: deleted, deletedAt: null },
    ]);
    const notes = await Notes.find().sort({ title: 1 }).populate("folder").policy({ tenant: "t" }).lean();
    expect(notes.map((note) => note.folder?.name ?? null)).toEqual(["live", null]);
    const rows = await Notes.aggregate(
      (p) => p.lookup({ from: Folder, localField: "folder", foreignField: "_id", as: "f" }).project({ title: 1, f: 1 }),
      { policy: { tenant: "t", includeDeleted: true } },
    );
    expect(Object.fromEntries(rows.map((row) => [row.title, (row.f as unknown[]).length]))).toEqual({ one: 1, two: 0 });
  });

  test("uniqueIndexHints: a unique index without a partial filter on the delete date", async () => {
    const hints = SoftDeletePolicy.uniqueIndexHints(ModelInternals.schema(Accounts));
    expect(hints.length).toBe(1);
    expect(hints[0]).toContain('partialFilterExpression: { removedAt: { $type: "null" } }');
    /* Why: with a plain unique index a deleted account keeps its email taken. */
    await Accounts.createIndexes();
    await Accounts.deleteOne({ email: "ann@x" });
    await expect(Accounts.create({ email: "ann@x" })).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  test("the hinted partial index works on the server: a deleted document frees its value", async () => {
    const coll = t.mongo.db.collection("m9_accounts_partial");
    await coll.createIndex({ email: 1 }, { unique: true, partialFilterExpression: { removedAt: { $type: "null" } } });
    await coll.insertOne({ email: "x@x", removedAt: past });
    await coll.insertOne({ email: "x@x", removedAt: null });
    await expect(coll.insertOne({ email: "x@x", removedAt: null })).rejects.toThrow(/E11000/);
  });
});
