/*
 * The tenant policy on EVERY path, on the real server. Two tenants' documents
 * live in one collection; every operation of tenant A is run and the tests check that tenant B's documents
 * are never read, counted, changed, deleted, joined or populated (negative leak tests), that inserts and
 * replacements carry the tenant, and that an operation without a tenant is refused before anything is sent.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { CastError, fn, type Model, PolicyContext, QueryError, StrictModeError } from "../../../src/index.ts";
import { Folder, Label, Note, OrgDoc } from "../../fixtures/mechanisms/mechanism-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("m9_tenant");
const A = new ObjectId();
const B = new ObjectId();
let Docs: Model<OrgDoc>;
let Notes: Model<Note>;
let Folders: Model<Folder>;
const folderA = new ObjectId();
const folderB = new ObjectId();

/**
 * Runs work in the scope of tenant A.
 * @param work The work to run.
 * @returns The result of the work.
 */
const inA = <R>(work: () => R): R => PolicyContext.run({ tenant: A.toHexString() }, work);
/**
 * A matcher for the `StrictModeError` a missing scope produces.
 * @param reason Which policy refused the operation.
 * @returns An asymmetric matcher.
 */
const tenantError = (reason: "tenant" | "soft-delete" = "tenant") =>
  expect.objectContaining({ name: "StrictModeError", reason });
/**
 * The raw collection of the tenant-scoped documents.
 * @returns The driver collection.
 */
const raw = () => t.mongo.db.collection("m9_orgdocs");

beforeEach(async () => {
  Docs = t.connection.model(OrgDoc);
  Notes = t.connection.model(Note);
  Folders = t.connection.model(Folder);
  t.connection.model(Label); /* registered: a join target of the tests */
  await raw().insertMany([
    { _id: new ObjectId(), org: A, body: "a1" },
    { _id: new ObjectId(), org: A, body: "a2" },
    { _id: new ObjectId(), org: B, body: "b1" },
    { _id: new ObjectId(), org: B, body: "shared" },
    { _id: new ObjectId(), org: A, body: "shared" },
  ]);
  await t.mongo.db.collection("m9_folders").insertMany([
    { _id: folderA, tenantId: "ta", name: "fa", deletedAt: null },
    { _id: folderB, tenantId: "tb", name: "fb", deletedAt: null },
  ]);
  await t.mongo.db.collection("m9_notes").insertMany([
    { tenantId: "ta", title: "na", folder: folderA, deletedAt: null },
    { tenantId: "ta", title: "na-to-b", folder: folderB, deletedAt: null },
    { tenantId: "tb", title: "nb", folder: folderB, deletedAt: null },
  ]);
  await t.mongo.db.collection("m9_labels").insertMany([{ name: "free" }]);
  t.commands.clear();
});

/**
 * The sorted bodies of some documents.
 * @param docs The documents.
 * @returns The bodies in alphabetical order.
 */
const bodies = (docs: readonly { readonly body: string }[]) => docs.map((doc) => doc.body).sort();

describe("reads are scoped (no document of another tenant, ever)", () => {
  test("find / findOne / findById / exists / cursor / explain", async () => {
    expect(bodies(await inA(() => Docs.find()).lean())).toEqual(["a1", "a2", "shared"]);
    expect(bodies(await inA(() => Docs.find({ body: "shared" })).lean())).toEqual(["shared"]);
    const bDoc = await raw().findOne({ org: B, body: "b1" });
    expect(await inA(() => Docs.findById(bDoc?._id as ObjectId))).toBeNull();
    expect(await inA(() => Docs.findOne({ body: "b1" }))).toBeNull();
    expect(await inA(() => Docs.exists({ body: "b1" }))).toBeNull();
    const seen: string[] = [];
    for await (const doc of inA(() => Docs.find().cursor())) seen.push(doc.body);
    expect(seen.sort()).toEqual(["a1", "a2", "shared"]);
    const plan = (await inA(() => Docs.find({ body: "x" })).explain()) as { command?: { filter?: unknown } };
    expect(Bun.inspect(plan, { depth: 20 })).toContain(A.toHexString());
  });

  test("a user condition on the tenant field is kept AND the tenant is added ($and): no way out", async () => {
    /* Asking for tenant B's documents from tenant A finds nothing (never B's documents). */
    expect(await inA(() => Docs.find({ org: B })).lean()).toEqual([]);
    expect(await inA(() => Docs.find({ $or: [{ org: B }, { body: "b1" }] })).lean()).toEqual([]);
    const sent = t.commands.byName("find").at(-1)?.command.filter as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(["$or", "org"]);
  });

  test("countDocuments / distinct", async () => {
    expect(await inA(() => Docs.countDocuments())).toBe(3);
    expect(await inA(() => Docs.countDocuments({ body: "b1" }))).toBe(0);
    expect((await inA(() => Docs.distinct("body"))).sort()).toEqual(["a1", "a2", "shared"]);
  });

  test("estimatedDocumentCount is refused (it would count every tenant) — countDocuments is the way", async () => {
    await expect(inA(() => Docs.estimatedDocumentCount()).exec()).rejects.toThrow(/use countDocuments\(\)/);
    await expect(inA(() => Docs.estimatedDocumentCount()).exec()).rejects.toEqual(tenantError());
    /* Cross-tenant work may use it (explicit). */
    expect(await Docs.estimatedDocumentCount().policy({ allTenants: true })).toBe(5);
  });
});

describe("writes are scoped", () => {
  test("updateOne / updateMany touch only the tenant's documents", async () => {
    const many = await inA(() => Docs.updateMany({ body: "shared" }, { $set: { body: "S" } }));
    expect(many.matchedCount).toBe(1);
    expect(await raw().countDocuments({ org: B, body: "shared" })).toBe(1);
    const one = await inA(() => Docs.updateOne({ body: "b1" }, { $set: { body: "stolen" } }));
    expect(one.matchedCount).toBe(0);
    expect(await raw().countDocuments({ body: "stolen" })).toBe(0);
  });

  test("an update may not move a document to another tenant (nor unset the field)", async () => {
    await expect(inA(() => Docs.updateOne({ body: "a1" }, { $set: { org: B } })).exec()).rejects.toEqual(tenantError());
    await expect(inA(() => Docs.updateOne({ body: "a1" }, { $unset: { org: "" } } as never)).exec()).rejects.toEqual(
      tenantError(),
    );
    /* $set of the SAME tenant is harmless. */
    const same = await inA(() => Docs.updateOne({ body: "a1" }, { $set: { org: A } }));
    expect(same.matchedCount).toBe(1);
    await expect(
      inA(() => Docs.updateOne({ body: "a1" }, (p) => p.set(() => ({ org: fn.literal(B) })))).exec(),
    ).rejects.toEqual(tenantError());
  });

  test("upsert: the new document belongs to the tenant (from the scoped filter)", async () => {
    const result = await inA(() => Docs.updateOne({ body: "new" }, { $set: { body: "new" } }, { upsert: true }));
    expect(result.upsertedCount).toBe(1);
    const stored = await raw().findOne({ _id: result.upsertedId as ObjectId });
    expect(stored?.org).toEqual(A);
  });

  test("replaceOne / findOneAndReplace keep the tenant field (a replacement without it gets it)", async () => {
    await inA(() => Docs.replaceOne({ body: "a1" }, { body: "a1-replaced" } as never));
    expect(await raw().findOne({ body: "a1-replaced" })).toMatchObject({ org: A });
    await inA(() => Docs.findOneAndReplace({ body: "a2" }, { body: "a2-replaced" } as never));
    expect(await raw().findOne({ body: "a2-replaced" })).toMatchObject({ org: A });
    await expect(inA(() => Docs.replaceOne({ body: "shared" }, { body: "x", org: B })).exec()).rejects.toEqual(
      tenantError(),
    );
    /* B's document is never replaced. */
    const result = await inA(() => Docs.replaceOne({ body: "b1" }, { body: "gone" } as never));
    expect(result.matchedCount).toBe(0);
    expect(await raw().countDocuments({ body: "b1" })).toBe(1);
  });

  test("deleteOne / deleteMany / findOneAnd* never reach another tenant", async () => {
    expect((await inA(() => Docs.deleteMany({ body: "shared" }))).deletedCount).toBe(1);
    expect(await raw().countDocuments({ org: B, body: "shared" })).toBe(1);
    expect(await inA(() => Docs.findOneAndDelete({ body: "b1" }))).toBeNull();
    expect(await inA(() => Docs.findOneAndUpdate({ body: "b1" }, { $set: { body: "x" } }))).toBeNull();
    expect(await raw().countDocuments({ org: B })).toBe(2);
  });
});

describe("inserts carry the tenant", () => {
  test("insertOne / insertMany / create / save: set when absent", async () => {
    const one = await inA(() => Docs.insertOne({ body: "i1" }));
    expect(one.org).toEqual(A);
    await inA(() => Docs.insertMany([{ body: "i2" }, { body: "i3" }]));
    const created = await inA(() => Docs.create({ body: "c1" }));
    expect(created.org).toEqual(A); /* the document in memory has it too */
    const fresh = inA(() => Docs.new({ body: "n1" }));
    await inA(() => fresh.$save());
    expect(fresh.org).toEqual(A);
    expect(await raw().countDocuments({ org: A, body: { $in: ["i1", "i2", "i3", "c1", "n1"] } })).toBe(5);
  });

  test("TenantField — create/replace take no tenant field (typed), every read form has it (typed, required)", async () => {
    await inA(() => Docs.create({ body: "m5" }));
    await inA(() => Docs.replaceOne({ body: "m5" }, { body: "m5r" }));
    const lean = await inA(() => Docs.findOne({ body: "m5r" }).lean().orFail());
    const org: ObjectId = lean.org; /* required in the read type, no marker */
    expect(org).toEqual(A);
    const hydrated = await inA(() => Docs.findOne({ body: "m5r" }).orFail());
    expect(hydrated.org).toEqual(A);
  });

  test("another tenant's value is an error; the tenant value is cast by the field (ObjectId from a string)", async () => {
    await expect(inA(() => Docs.insertOne({ body: "x", org: B }))).rejects.toEqual(tenantError());
    await expect(inA(() => Docs.create({ body: "x", org: B }))).rejects.toEqual(tenantError());
    await expect(
      PolicyContext.run({ tenant: "not-an-id" }, () => Docs.insertOne({ body: "x" })),
    ).rejects.toBeInstanceOf(CastError);
  });

  test("bulkWrite: insertOne stamped, every filter scoped, replaceOne keeps the field", async () => {
    const result = await inA(() =>
      Docs.bulkWrite([
        { insertOne: { document: { body: "bw" } } },
        { updateMany: { filter: { body: "shared" }, update: { $set: { body: "bulk" } } } },
        { deleteOne: { filter: { body: "b1" } } },
        { replaceOne: { filter: { body: "a1" }, replacement: { body: "a1r" } } },
      ]),
    );
    expect(result.insertedCount).toBe(1);
    expect(result.modifiedCount).toBe(2);
    expect(result.deletedCount).toBe(0);
    expect(await raw().countDocuments({ org: B })).toBe(2);
    expect(await raw().findOne({ body: "a1r" })).toMatchObject({ org: A });
    expect(await raw().findOne({ body: "bw" })).toMatchObject({ org: A });
  });
});

describe("aggregations, joins and populate", () => {
  test("$match at the start; the rows are the tenant's", async () => {
    const rows = await inA(() => Docs.aggregate((p) => p.group((f) => ({ _id: f.body, n: fn.sum(1) }))));
    expect(rows.map((row) => row._id).sort()).toEqual(["a1", "a2", "shared"]);
  });

  test("$lookup of a tenant-scoped model gets ITS scope (no other tenant's folder is joined)", async () => {
    const rows = await PolicyContext.run({ tenant: "ta" }, () =>
      Notes.aggregate((p) =>
        p
          .lookup({ from: Folder, localField: "folder", foreignField: "_id", as: "folders" })
          .project({ title: 1, folders: 1 }),
      ),
    );
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, (row.folders as unknown[]).length]));
    expect(byTitle).toEqual({ na: 1, "na-to-b": 0 });
  });

  test("$unionWith and $graphLookup are scoped; a join of an unscoped model is not", async () => {
    const union = await PolicyContext.run({ tenant: "ta" }, () =>
      Folders.aggregate((p) => p.unionWith(Folder).project({ name: 1 })),
    );
    expect(union.map((row) => row.name).sort()).toEqual(["fa", "fa"]);
    const graph = await PolicyContext.run({ tenant: "ta" }, () =>
      Notes.aggregate((p) =>
        p
          .graphLookup({
            from: Folder,
            startWith: (f) => f.folder,
            connectFromField: "_id",
            connectToField: "_id",
            as: "chain",
          })
          .project({ title: 1, chain: 1 }),
      ),
    );
    expect(Object.fromEntries(graph.map((row) => [row.title, (row.chain as unknown[]).length]))).toEqual({
      na: 1,
      "na-to-b": 0,
    });
    const labels = await PolicyContext.run({ tenant: "ta" }, () =>
      Notes.aggregate((p) =>
        p.lookup({ from: Label, pipeline: (q) => q.project({ name: 1 }), as: "labels" }).project({ labels: 1 }),
      ),
    );
    expect(labels.every((row) => (row.labels as unknown[]).length === 1)).toBe(true);
  });

  test("$out / $merge into a tenant-scoped collection are refused", async () => {
    await expect(inA(() => Docs.aggregate((p) => p.match({ body: "a1" }).out("m9_orgdocs"))).exec()).rejects.toEqual(
      tenantError(),
    );
  });

  test("populate: the referenced documents of another tenant are not found", async () => {
    const notes = await PolicyContext.run({ tenant: "ta" }, () =>
      Notes.find().sort({ title: 1 }).populate("folder").lean(),
    );
    expect(notes.map((note) => note.folder?.name ?? null)).toEqual(["fa", null]);
  });
});

describe("the context", () => {
  test("no tenant: every operation is refused before anything is sent", async () => {
    t.commands.clear();
    await expect(Docs.find().exec()).rejects.toEqual(tenantError());
    await expect(Docs.countDocuments().exec()).rejects.toEqual(tenantError());
    await expect(Docs.updateMany({ body: "a1" }, { $set: { body: "x" } }).exec()).rejects.toEqual(tenantError());
    await expect(Docs.insertOne({ body: "x" })).rejects.toEqual(tenantError());
    await expect(Docs.aggregate((p) => p.match({})).exec()).rejects.toEqual(tenantError());
    await expect(Docs.find().exec()).rejects.toThrow(/has no tenant/);
    expect(t.commands.all().filter((event) => event.commandName !== "endSessions").length).toBe(0);
  });

  test("the scope is taken when the operation is BUILT (a builder awaited elsewhere keeps its tenant)", async () => {
    const built = inA(() => Docs.find({ body: "shared" }).lean());
    const docs = await PolicyContext.run({ tenant: B.toHexString() }, () => built);
    expect(docs.map((doc) => doc.org)).toEqual([A]);
    /* Built outside any scope: no tenant, even when awaited inside one. */
    const outside = Docs.find().lean();
    await expect(PolicyContext.run({ tenant: A.toHexString() }, () => outside.exec())).rejects.toEqual(tenantError());
  });

  test(".policy({ tenant }) is explicit per operation; allTenants: true is explicit cross-tenant work", async () => {
    expect(bodies(await Docs.find().policy({ tenant: B }).lean())).toEqual(["b1", "shared"]);
    expect((await Docs.find().policy({ allTenants: true }).lean()).length).toBe(5);
    expect(await Docs.countDocuments().policy({ allTenants: true })).toBe(5);
    await expect(
      Promise.resolve().then(() => Docs.find().policy({ tenant: A, allTenants: true })),
    ).rejects.toBeInstanceOf(QueryError);
  });

  test("change streams of a tenant-scoped model are refused without allTenants", async () => {
    await expect(Docs.watch()).rejects.toEqual(tenantError());
  });

  test("the watch hint names the real way out: PolicyContext.run with allTenants, around the watch call", async () => {
    const error = (await Docs.watch().catch((caught: unknown) => caught)) as Error;
    expect(error.message).toContain("OrgDoc.watch:");
    expect(error.message).toContain("watch inside PolicyContext.run({ allTenants: true }, () => OrgDoc.watch())");
    const stream = await PolicyContext.run({ allTenants: true }, () => Docs.watch());
    await stream.close();
  });

  test("the error type is StrictModeError", async () => {
    await expect(Docs.find().exec()).rejects.toBeInstanceOf(StrictModeError);
  });
});

describe("a tenant is a non-empty value", () => {
  test("PolicyContext.run: an empty, a whitespace-only or a null tenant is refused (StrictModeError tenant)", () => {
    for (const tenant of ["", "   ", null]) {
      expect(() => PolicyContext.run({ tenant }, () => Notes.find())).toThrow(StrictModeError);
      let caught: unknown;
      try {
        PolicyContext.run({ tenant }, () => undefined);
      } catch (error) {
        caught = error;
      }
      expect(caught).toEqual(tenantError());
    }
  });

  test(".policy(): an empty tenant is refused, before anything is sent", () => {
    expect(() => Notes.find().policy({ tenant: "" })).toThrow(StrictModeError);
    expect(() => Notes.find().policy({ tenant: " \t" })).toThrow(StrictModeError);
    expect(t.commands.byName("find").length).toBe(0);
  });

  test("writes: an empty tenant in the options, or written by cross-tenant work, is refused; nothing is stored", async () => {
    await expect(Notes.create({ title: "x" }, { policy: { tenant: "" } })).rejects.toEqual(tenantError());
    /* The text names the method the user called: create, never save. */
    const named = (await Notes.create({ title: "x" }, { policy: { tenant: "" } }).catch(
      (caught: unknown) => caught,
    )) as Error;
    expect(named.message).toStartWith("create.policy: the tenant is empty");
    await expect(
      Notes.insertMany([{ tenantId: "", title: "y" }], { policy: { allTenants: true } }),
    ).rejects.toBeDefined();
    await expect(Notes.create({ tenantId: "  ", title: "z" }, { policy: { allTenants: true } })).rejects.toEqual(
      tenantError(),
    );
    await expect(
      Notes.updateMany({ title: "na" }, { $set: { tenantId: "" } })
        .policy({ allTenants: true })
        .exec(),
    ).rejects.toEqual(tenantError());
    expect(await t.mongo.db.collection("m9_notes").countDocuments({ tenantId: { $in: ["", "  "] } })).toBe(0);
  });

  test("allTenants: true stays the explicit cross-tenant form", async () => {
    expect(await Notes.countDocuments().policy({ allTenants: true })).toBe(3);
  });
});

describe("the no-tenant hint names an option the call really has", () => {
  test("create / insertOne: { policy: { tenant } } in the options — and it works", async () => {
    const hint = /pass \{ policy: \{ tenant \} \} in the call's options/;
    await expect(Docs.create({ body: "x" })).rejects.toThrow(hint);
    await expect(Docs.insertOne({ body: "x" })).rejects.toThrow(hint);
    const created = await Docs.create({ body: "c" }, { policy: { tenant: A.toHexString() } });
    expect(created.org).toEqual(A);
    const inserted = await Docs.insertOne({ body: "i" }, { policy: { tenant: B.toHexString() } });
    expect(inserted.org).toEqual(B);
  });

  test("a query: .policy({ tenant }) on the query — and it works", async () => {
    await expect(Docs.find({ body: "a1" }).exec()).rejects.toThrow(/add \.policy\(\{ tenant \}\) to the query/);
    expect(bodies(await Docs.find({ body: "a1" }).policy({ tenant: A }).lean())).toEqual(["a1"]);
  });
});
