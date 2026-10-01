/*
 * The hook runtime on the real server — every query/model/aggregate event with its pre
 * and post hooks in order, the symmetry rule (exactly one of post/postError per operation, on EVERY path:
 * cast errors, pre hook errors, ordered and unordered bulks, empty insertMany/bulkWrite, cursors), skip from a
 * pre hook with a typed result, `locals` shared by the hooks of one operation, plugin hooks after class
 * hooks, the document events of a root and its subdocuments (sequential, validate hooks after their
 * own paths), `document.init`, `document.updateOne`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { BulkWriteError, CastError, type Model, QueryError, ValidationError } from "../../../src/index.ts";
import { Hooked9, HookTrace } from "../../fixtures/mechanisms/hook-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("m9_hooks");
let Hooked: Model<Hooked9>;
/**
 * The raw collection of the hooked entity.
 * @returns The driver collection.
 */
const raw = () => t.mongo.db.collection("m9_hooked");
const id = new ObjectId();

beforeEach(async () => {
  Hooked = t.connection.model(Hooked9);
  await raw().insertMany([
    { _id: id, name: "a", n: 1 },
    { name: "b", n: 2 },
  ]);
  HookTrace.reset();
  t.commands.clear();
});

/**
 * The recorded hook trace without the `init` lines.
 * @returns The trace lines.
 */
const lines = () => HookTrace.lines.filter((line) => !line.includes(" init "));

describe("every operation event: pre → driver → post, with locals", () => {
  test("reads", async () => {
    await Hooked.find().lean();
    await Hooked.findOne({ name: "a" }).lean();
    await Hooked.countDocuments();
    await Hooked.estimatedDocumentCount();
    await Hooked.distinct("name");
    await Hooked.aggregate((p) => p.match({ name: "a" }));
    expect(lines()).toEqual([
      "pre query.find",
      "plugin pre query.find",
      "post query.find [2] find",
      "pre query.findOne",
      "post query.findOne object findOne",
      "pre query.countDocuments",
      "post query.countDocuments number countDocuments",
      "pre query.estimatedDocumentCount",
      "post query.estimatedDocumentCount number estimatedDocumentCount",
      "pre query.distinct",
      "post query.distinct [2] distinct",
      "pre aggregate",
      "post aggregate [1] aggregate",
    ]);
  });

  test("writes", async () => {
    await Hooked.updateOne({ name: "a" }, { $set: { n: 5 } });
    await Hooked.updateMany({ name: "a" }, { $set: { n: 6 } });
    await Hooked.replaceOne({ name: "a" }, { name: "a", n: 7 });
    await Hooked.findOneAndUpdate({ name: "a" }, { $set: { n: 8 } }).lean();
    await Hooked.findOneAndReplace({ name: "a" }, { name: "a" }).lean();
    await Hooked.insertMany([{ name: "c" }]);
    await Hooked.bulkWrite([{ updateOne: { filter: { name: "c" }, update: { $set: { n: 1 } } } }]);
    await Hooked.findOneAndDelete({ name: "c" }).lean();
    await Hooked.deleteOne({ name: "b" });
    await Hooked.deleteMany({ name: "a" });
    expect(lines().filter((line) => line.startsWith("post"))).toEqual([
      "post query.updateOne object updateOne",
      "post query.updateMany object updateMany",
      "post query.replaceOne object replaceOne",
      "post query.findOneAndUpdate object findOneAndUpdate",
      "post query.findOneAndReplace object findOneAndReplace",
      "post model.insertMany [1] insertMany",
      "post model.bulkWrite object bulkWrite",
      /* The bulk's updateOne fires its own query hooks, after the bulk's post. */
      "post query.updateOne object updateOne",
      "post query.findOneAndDelete object findOneAndDelete",
      "post query.deleteOne object deleteOne",
      "post query.deleteMany object deleteMany",
    ]);
  });
});

describe("symmetry: exactly one of post / postError on every path", () => {
  test("a cast error before the pre hooks → postError", async () => {
    await expect(Hooked.find({ n: "x" as never }).exec()).rejects.toBeInstanceOf(CastError);
    expect(lines()).toEqual(["postError query.find CastError"]);
  });

  test("a pre hook that throws → postError, the driver is not called", async () => {
    HookTrace.failAt.add("pre query.updateOne");
    await expect(Hooked.updateOne({ name: "a" }, { $set: { n: 1 } }).exec()).rejects.toBe(HookTrace.failure);
    expect(lines()).toEqual(["pre query.updateOne", "postError query.updateOne Error"]);
    expect(t.commands.byName("update").length).toBe(0);
  });

  test("ordered and unordered bulks failing in the driver → postError, once", async () => {
    await expect(Hooked.insertMany([{ _id: id, name: "dup" } as never], { ordered: true })).rejects.toBeInstanceOf(
      BulkWriteError,
    );
    await expect(
      Hooked.insertMany([{ name: "ok" }, { _id: id, name: "dup" } as never], { ordered: false }),
    ).rejects.toBeInstanceOf(BulkWriteError);
    await expect(
      Hooked.bulkWrite([{ insertOne: { document: { _id: id, name: "dup" } as never } }], { ordered: false }),
    ).rejects.toBeInstanceOf(BulkWriteError);
    expect(lines().filter((line) => line.startsWith("postError"))).toEqual([
      "postError model.insertMany BulkWriteError",
      "postError model.insertMany BulkWriteError",
      "postError model.bulkWrite BulkWriteError",
    ]);
    /* The documents of insertMany and of the bulk's insertOne end in exactly one of post (stored) or postError
       (not stored). */
    expect(lines().filter((line) => /^root post(Error)? save/.test(line))).toEqual([
      "root postError save BulkWriteError",
      "root post save",
      "root postError save BulkWriteError",
      "root postError save BulkWriteError",
    ]);
  });

  test("an unordered bulk whose every document is invalid (nothing sent) → postError", async () => {
    await expect(Hooked.insertMany([{ name: 5 as never }], { ordered: false })).rejects.toBeInstanceOf(BulkWriteError);
    expect(lines()).toEqual(["pre model.insertMany", "postError model.insertMany BulkWriteError"]);
  });

  test("empty insertMany([]) and bulkWrite([]) run their hooks (Mongoose skipped post), send nothing", async () => {
    expect(await Hooked.insertMany([])).toEqual([]);
    expect((await Hooked.bulkWrite([])).insertedCount).toBe(0);
    expect(lines()).toEqual([
      "pre model.insertMany",
      "post model.insertMany [0] insertMany",
      "pre model.bulkWrite",
      "post model.bulkWrite object bulkWrite",
    ]);
    expect(t.commands.byName("insert").length + t.commands.byName("update").length).toBe(0);
  });

  test("a cursor: post per driver batch after hydration (a later failure: see pipeline-invariants.test.ts)", async () => {
    await raw().insertMany(Array.from({ length: 5 }, (_, index) => ({ name: `x${index}` })));
    const seen: string[] = [];
    for await (const doc of Hooked.find().batchSize(3).cursor()) seen.push(doc.name);
    expect(seen.length).toBe(7);
    expect(lines().filter((line) => line.startsWith("post"))).toEqual([
      "post query.find [3] find",
      "post query.find [3] find",
      "post query.find [1] find",
    ]);
  });

  test("a post hook that throws: the error reaches the caller, no postError (the operation had succeeded)", async () => {
    HookTrace.failAt.add("post query.countDocuments number countDocuments");
    await expect(Hooked.countDocuments().exec()).rejects.toBe(HookTrace.failure);
    expect(lines()).toEqual(["pre query.countDocuments", "post query.countDocuments number countDocuments"]);
  });
});

describe("skip from a pre hook", () => {
  test("a find is not sent; its documents go through hydration (a hydrated document of the model)", async () => {
    HookTrace.skips.set("query.find", [{ _id: new ObjectId(), name: "cached" }]);
    const docs = await Hooked.find();
    expect(docs.map((doc) => doc.name)).toEqual(["cached"]);
    expect(typeof docs[0]?.$save).toBe("function");
    expect(t.commands.byName("find").length).toBe(0);
    /* The remaining pre hooks (the plugin's) did not run; the post hooks did, with the pre hook's locals. */
    expect(lines()).toEqual(["pre query.find", "post query.find [1] find"]);
  });

  test("findOne null → orFail applies; a count; an update result; a cursor yields the skipped rows", async () => {
    HookTrace.skips.set("query.findOne", null);
    await expect(Hooked.findOne({ name: "a" }).orFail().exec()).rejects.toThrow(/no document matched/);
    HookTrace.skips.set("query.countDocuments", 42);
    expect(await Hooked.countDocuments()).toBe(42);
    HookTrace.skips.set("query.updateMany", { matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null });
    expect((await Hooked.updateMany({ name: "a" }, { $set: { n: 9 } })).matchedCount).toBe(0);
    expect(t.commands.byName("update").length).toBe(0);
    HookTrace.skips.set("query.find", [{ _id: new ObjectId(), name: "c1" }]);
    const names: string[] = [];
    for await (const doc of Hooked.find().cursor()) names.push(doc.name);
    expect(names).toEqual(["c1"]);
  });

  test("a skipped document is cast by the schema (a hook cannot return what the server never would)", async () => {
    HookTrace.skips.set("query.find", [{ name: 5 }]);
    await expect(Hooked.find().exec()).rejects.toBeInstanceOf(CastError);
  });

  test("distinct and aggregate rows are returned as the hook gives them", async () => {
    HookTrace.skips.set("query.distinct", ["x"]);
    expect(await Hooked.distinct("name")).toEqual(["x"]);
    HookTrace.skips.set("aggregate", [{ total: 3 }]);
    expect(await Hooked.aggregate((p) => p.match({ name: "a" }))).toEqual([{ total: 3 }] as never);
    expect(t.commands.byName("aggregate").length).toBe(0);
  });

  test("skip is for pre hooks only: from a post hook it is a QueryError", async () => {
    HookTrace.skipInPost = true;
    await expect(Hooked.countDocuments().exec()).rejects.toBeInstanceOf(QueryError);
  });
});

describe("document events: root and subdocuments", () => {
  test("save of a new document: the full order, subdocuments sequential, validate after their own paths", async () => {
    await Hooked.create({ name: "r", branches: [{ name: "b1", leaves: [{ name: "l1" }, { name: "l2" }] }] });
    expect(HookTrace.lines).toEqual([
      "root pre save",
      "plugin pre document.save",
      "branch b1 pre save",
      "leaf l1 pre save",
      "leaf l2 pre save",
      "root pre validate",
      "branch b1 pre validate",
      "leaf l1 pre validate",
      "leaf l2 pre validate",
      "branch b1 post validate",
      "leaf l1 post validate",
      "leaf l2 post validate",
      "root post validate",
      "branch b1 post save",
      "leaf l1 post save",
      "leaf l2 post save",
      "root post save",
    ]);
  });

  test("a subdocument's own invalid path: its postError(validate) gets ITS issues; the others post", async () => {
    await expect(
      Hooked.create({ name: "r", branches: [{ name: "b1", leaves: [{ name: "ok" }, { name: "bad-leaf" }] }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const validate = HookTrace.lines.filter((line) => line.includes("validate") && !line.includes("pre"));
    /*
     * The branch holds the bad leaf: the issue is under its path too, so it ends in postError (it has none
     * of its own, but the branch hooks here have no postError(validate): nothing is recorded for it).
     */
    expect(validate).toEqual([
      "leaf ok post validate",
      expect.stringMatching(/^leaf bad-leaf postError validate .*branches\.0\.leaves\.1\.name.*bad leaf/),
      "root postError validate",
    ]);
    /* Every (sub)document whose pre(save) ran ends in postError(save). */
    expect(HookTrace.lines.filter((line) => line.includes("postError save"))).toEqual([
      "leaf ok postError save",
      "leaf bad-leaf postError save",
      "root postError save ValidationError",
    ]);
  });

  test("a failing root pre(save) hook → postError(save)", async () => {
    HookTrace.failAt.add("root pre save");
    await expect(Hooked.create({ name: "r" })).rejects.toBe(HookTrace.failure);
    expect(HookTrace.lines).toEqual(["root pre save", "root postError save Error"]);
  });

  test("document.init after a read hydrated the document (subdocuments too); not for lean reads", async () => {
    await raw().updateOne(
      { _id: id },
      { $set: { branches: [{ _id: new ObjectId(), name: "b", leaves: [{ name: "l" }] }] } },
    );
    await Hooked.findById(id);
    expect(HookTrace.lines.filter((line) => line.includes("init"))).toEqual([
      "root pre init a",
      "leaf l init",
      "root post init a",
    ]);
    HookTrace.reset();
    await Hooked.findById(id).lean();
    expect(HookTrace.lines.filter((line) => line.includes("init"))).toEqual([]);
    HookTrace.reset();
    Hooked.hydrate({ _id: new ObjectId(), name: "h" });
    expect(HookTrace.lines).toEqual(["root pre init h", "root post init h"]);
  });

  test("$updateOne: document.updateOne hooks around an ordinary update; no query hook", async () => {
    const doc = await Hooked.findById(id).orFail();
    HookTrace.reset();
    const result = await doc.$updateOne({ $set: { n: 50 } });
    expect(result.modifiedCount).toBe(1);
    expect(HookTrace.lines).toEqual(["root pre updateOne a", "root post updateOne 1"]);
    expect((await raw().findOne({ _id: id }))?.n).toBe(50);
    expect(doc.n).toBe(1); /* the document in memory is not changed */
  });

  test("$deleteOne: the subdocuments' deleteOne hooks run too", async () => {
    await raw().updateOne(
      { _id: id },
      { $set: { branches: [{ _id: new ObjectId(), name: "b", leaves: [{ name: "l" }] }] } },
    );
    const doc = await Hooked.findById(id).orFail();
    HookTrace.reset();
    await doc.$deleteOne();
    expect(HookTrace.lines).toEqual(["root pre deleteOne", "leaf l pre deleteOne", "root post deleteOne"]);
  });
});
