import { beforeEach, describe, expect, test } from "bun:test";
import { CommandRecorder, MongoLifecycle } from "@venloc/typemo-test-kit";
import { type Document, ObjectId } from "mongodb";
import { BsonOptions, DbNames, Filters, fn, ModelOperations, Pipeline, SchemaCompiler } from "../../../src/internal.ts";
import { OperationView } from "../../../src/operation/steps/operation-view.ts";
import type { ResultShape } from "../../../src/operation/steps/result-shape.ts";
import { Account, Click, Event, Plain, View } from "../../fixtures/steps/step-entities.ts";
import { PlanCapture, RawExecute, StepHarness } from "../../fixtures/steps/step-harness.ts";

/*
 * Plans produced by the pipeline steps are sent through the RAW driver exactly as the context holds
 * them (what `execute` will send); the server's answer and the recorded wire commands prove the
 * cast, the dbName translation, the hidden fields, defaults/timestamps/version.
 */

const mongo = MongoLifecycle.useMongo("steps_6b", BsonOptions.apply({}));
const capture = new PlanCapture();
const Accounts = new ModelOperations(Account, capture);
const Events = new ModelOperations(Event, capture);
const Clicks = new ModelOperations(Click, capture);
type Loose = Record<string, unknown>;
/**
 * Drops the static type of a value, for plans beyond the static types.
 * @param value The value.
 * @returns The same value typed as `any`.
 */
// biome-ignore lint/suspicious/noExplicitAny: plans beyond the static types in a few places.
const loose = (value: unknown): any => value;

/**
 * Runs an insert plan through the steps and the raw driver.
 * @param entity The entity class.
 * @param documents The documents to insert.
 * @returns The operation context after the run.
 */
const insert = async (entity: Parameters<typeof StepHarness.insert>[0], documents: Loose[]) => {
  const ctx = await StepHarness.full(StepHarness.insert(entity, documents));
  await RawExecute.run(mongo.db, ctx);
  return ctx;
};

/**
 * Runs a query plan through the steps and the raw driver.
 * @param query The query builder to capture.
 * @param models The models the steps may resolve.
 * @returns The operation context and the raw result.
 */
const run = async (query: PromiseLike<unknown>, models = [Account]) => {
  const ctx = await StepHarness.full(await capture.plan(query), models);
  return { ctx, result: await RawExecute.run(mongo.db, ctx) };
};

beforeEach(async () => {
  await insert(Account, [
    {
      name: "Ann",
      email: "ANN@x.test",
      password: "s1",
      age: 30,
      level: 3,
      visits: 5n,
      tags: ["a", "b"],
      items: [{ name: "pen", price: 2 }],
      address: { city: "Paris", zip: null },
      scores: { math: 5 },
    },
    {
      name: "Bob",
      email: "bob@x.test",
      age: 40,
      tags: ["b"],
      items: [{ name: "cup", price: 7, qty: 3 }],
      address: { city: "Rome", zip: "00100" },
    },
  ]);
});

describe("stored form", () => {
  test("inserted documents: stored names, defaults, timestamps, __v, Int32/Long on the wire", async () => {
    const raw = (await mongo.db.collection("s_accounts").findOne({ nm: "Ann" })) as Document;
    expect(raw).toMatchObject({
      nm: "Ann",
      email: "ann@x.test",
      pw: "s1",
      plan: "free",
      __v: 0,
      tg: ["a", "b"],
      ad: { c: "Paris", zip: null },
    });
    expect(raw.createdAt).toBeInstanceOf(Date);
    expect(raw.createdAt).toEqual(raw.updatedAt);
    expect(raw._id).toBeInstanceOf(ObjectId);
    expect(raw.its[0]).toMatchObject({ n: "pen", qty: 1, price: 2 });
    expect(raw.its[0]._id).toBeInstanceOf(ObjectId);
    expect(raw.sc).toEqual({ math: 5 });
    const typed = await mongo.db
      .collection("s_accounts")
      .findOne({ level: { $type: "int" }, visits: { $type: "long" } });
    expect(typed?.nm).toBe("Ann");
  });
});

describe("queries through the server", () => {
  test("a filter in code names finds the stored documents; rows translate back", async () => {
    const recorder = CommandRecorder.attach(mongo.client);
    const { result } = await run(
      Accounts.find({ "address.city": "Paris", "items.price": { $lt: 5 }, email: "ANN@X.TEST" }),
    );
    recorder.detach();
    const rows = result as Document[];
    expect(rows).toHaveLength(1);
    expect(recorder.byName("find")[0]?.filter).toEqual({
      "ad.c": "Paris",
      "its.price": { $lt: 5 },
      email: "ann@x.test",
    });
    const row = DbNames.toCode({ schema: SchemaCompiler.compileModel(Account), fields: new Map() }, rows[0]) as Loose;
    expect(row).toMatchObject({ name: "Ann", address: { city: "Paris", zip: null }, items: [{ name: "pen" }] });
    expect("password" in row).toBe(false);
  });

  test("projection, sort and $elemMatch in stored names", async () => {
    const { result } = await run(
      Accounts.find({ items: { $elemMatch: { name: "cup" } } })
        .select({ name: 1 })
        .sort({ age: -1 }),
    );
    expect((result as Document[]).map((doc) => Object.keys(doc).sort())).toEqual([["_id", "nm"]]);
  });

  test("Int32 comparison, $bitsAllSet, bigint and a Map key", async () => {
    expect(((await run(Accounts.find({ level: { $bitsAllSet: [0, 1] } }))).result as Document[]).length).toBe(1);
    expect(((await run(Accounts.find({ visits: { $gte: 5n } }))).result as Document[]).length).toBe(1);
    expect(((await run(Accounts.find(loose({ "scores.math": 5 })))).result as Document[]).length).toBe(1);
  });

  test("countDocuments and distinct in stored names", async () => {
    expect((await run(Accounts.countDocuments({ tags: "b" }))).result).toBe(2);
    expect(((await run(Accounts.distinct("items.name"))).result as string[]).sort()).toEqual(["cup", "pen"]);
  });
});

describe("updates through the server", () => {
  test("$set/$inc/$push with positional arrayFilters in stored names; updatedAt set, createdAt untouched", async () => {
    const before = (await mongo.db.collection("s_accounts").findOne({ nm: "Bob" })) as Document;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { result } = await run(
      Accounts.updateOne(
        { name: "Bob" },
        loose({ $set: { "items.$[i].price": 8, "address.city": "Milan" }, $inc: { age: 1 }, $push: { tags: "c" } }),
        loose({ arrayFilters: [{ "i.name": "cup" }] }),
      ),
    );
    expect(result).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
    const after = (await mongo.db.collection("s_accounts").findOne({ nm: "Bob" })) as Document;
    expect(after).toMatchObject({ age: 41, tg: ["b", "c"], ad: { c: "Milan" } });
    expect(after.its[0].price).toBe(8);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  test("$push of a subdocument fills its defaults and _id (6.8)", async () => {
    await run(Accounts.updateOne({ name: "Bob" }, loose({ $push: { items: { name: "new", price: 1 } } })));
    const after = (await mongo.db.collection("s_accounts").findOne({ nm: "Bob" })) as Document;
    expect(after.its[1]).toMatchObject({ n: "new", qty: 1, price: 1 });
    expect(after.its[1]._id).toBeInstanceOf(ObjectId);
  });

  test("upsert: defaults, createdAt and __v in $setOnInsert; the filter's equality kept", async () => {
    const recorder = CommandRecorder.attach(mongo.client);
    await run(
      Accounts.updateOne({ name: "Zed", email: "zed@x.test" }, loose({ $set: { age: 5 } }), loose({ upsert: true })),
    );
    recorder.detach();
    const sent = recorder.byName("update")[0]?.updates[0]?.update as Loose;
    /* name/email come from the filter's equality (the server copies them), age from $set: not defaulted; array fields without a default get [] (its, tg). */
    expect(Object.keys(sent.$setOnInsert as Loose).sort()).toEqual(["__v", "createdAt", "its", "plan", "tg"]);
    const doc = (await mongo.db.collection("s_accounts").findOne({ nm: "Zed" })) as Document;
    expect(doc).toMatchObject({ nm: "Zed", email: "zed@x.test", age: 5, plan: "free", __v: 0 });
    expect(doc.createdAt).toBeInstanceOf(Date);
  });

  test("without upsert there is no $setOnInsert", async () => {
    const recorder = CommandRecorder.attach(mongo.client);
    await run(Accounts.updateOne({ name: "Ann" }, { $set: { age: 31 } }));
    recorder.detach();
    const sent = recorder.byName("update")[0]?.updates[0]?.update as Loose;
    expect(Object.keys(sent)).toEqual(["$set"]);
    expect(Object.keys(sent.$set as Loose).sort()).toEqual(["age", "updatedAt"]);
  });

  test("updateMany with Filters.all(); an update pipeline gets updatedAt as a stage", async () => {
    const { result } = await run(Accounts.updateMany(Filters.all<Account>(), { $set: { plan: "pro" } }));
    expect(result).toMatchObject({ matchedCount: 2, modifiedCount: 2 });
    await run(Accounts.updateMany({ name: "Ann" }, (p) => p.set((f) => ({ age: fn.add(f.age, 1) }))));
    const ann = (await mongo.db.collection("s_accounts").findOne({ nm: "Ann" })) as Document;
    expect(ann.age).toBe(31);
  });

  test("deleteMany with a filter in stored names", async () => {
    expect((await run(Accounts.deleteMany({ "address.city": "Rome" }))).result).toMatchObject({ deletedCount: 1 });
  });
});

describe("aggregations through the server", () => {
  /**
   * Runs an aggregation plan through the steps and the raw driver.
   * @param pipeline The pipeline builder.
   * @param entity The entity class.
   * @returns The operation context and the raw result.
   */
  const aggregate = async (pipeline: { plan(): Parameters<typeof StepHarness.aggregate>[1] }, entity = Account) => {
    const ctx = await StepHarness.full(StepHarness.aggregate(entity, pipeline.plan()), [Account, Plain]);
    const rows = (await RawExecute.run(mongo.db, ctx)) as Document[];
    const shape = ctx.locals.get(OperationView.RESULT_SHAPE) as ResultShape;
    return rows.map((row) => DbNames.toCode(shape, row) as Loose);
  };

  test("match/sort/project in code names return rows in code names, without the hidden field", async () => {
    const rows = await aggregate(
      Pipeline.from(Account)
        .match({ age: { $gte: 30 } })
        .sort({ age: 1 })
        .project({ name: 1, "address.city": 1 }),
    );
    expect(rows.map((row) => row.name)).toEqual(["Ann", "Bob"]);
    expect(rows[0]).toEqual({ _id: expect.any(ObjectId), name: "Ann", address: { city: "Paris" } });
  });

  test("$group over stored names; $lookup rows translated by their shape", async () => {
    const grouped = await aggregate(
      Pipeline.from(Account)
        .unwind("$items")
        .group((f) => ({ _id: f.items.name, total: fn.sum(f.items.price) }))
        .sort({ _id: 1 }),
    );
    expect(grouped).toEqual([
      { _id: "cup", total: 7 },
      { _id: "pen", total: 2 },
    ]);
    const joined = await aggregate(
      Pipeline.from(Account)
        .match({ name: "Ann" })
        .lookup({ from: Account, localField: "tags", foreignField: "tags", as: "peers" }),
    );
    const peers = joined[0]?.peers as Loose[];
    expect(peers.map((peer) => peer.name).sort()).toEqual(["Ann", "Bob"]);
    expect(peers.every((peer) => !("password" in peer) && !("pw" in peer))).toBe(true);
  });

  test("$match literals are cast while the documents are stored documents; not after the field is replaced", async () => {
    const byEmail = await aggregate(Pipeline.from(Account).match({ email: "ANN@X.TEST" }));
    expect(byEmail.map((row) => row.name)).toEqual(["Ann"]);
    const replaced = await aggregate(
      Pipeline.from(Account)
        .addFields((f) => ({ age: fn.toString_(f.age) }))
        .match({ age: "30" }),
    );
    expect(replaced.map((row) => row.name)).toEqual(["Ann"]);
  });

  test("Hidden explicitly included (aggregateOptions.include)", async () => {
    const plan = Pipeline.from(Account).match({ name: "Ann" }).plan();
    const ctx = await StepHarness.full(
      loose({ ...StepHarness.aggregate(Account, plan), aggregateOptions: { include: ["password"] } }),
    );
    const rows = (await RawExecute.run(mongo.db, ctx)) as Document[];
    expect(rows[0]?.pw).toBe("s1");
  });
});

describe("discriminators", () => {
  test("a discriminator model filters by its key; inserts carry it; aliased discriminator field", async () => {
    await insert(Click, [{ at: new Date(), url: "/a" }]);
    await insert(View, [{ at: new Date(), ms: 3 }]);
    expect(((await run(Clicks.find({}))).result as Document[]).map((doc) => doc.u)).toEqual(["/a"]);
    expect(((await run(Events.find({}))).result as Document[]).length).toBe(2);
    await expect(StepHarness.full(await capture.plan(Clicks.estimatedDocumentCount()))).rejects.toThrow(
      /countDocuments/,
    );
  });
});
