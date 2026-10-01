/*
 * The operations inside `Model.bulkWrite` fire the hooks of their standalone counterparts: an `insertOne` the
 * document hooks of `Model.insertOne` (a pre-save change is stored), an update, replace or delete its
 * `query.<kind>` hooks (`this.bulkIndex`, `modify` changes that one operation, `skip` is refused); an upsert fires
 * no document hooks. Post hooks run after the whole bulk: `model.bulkWrite`, then per operation in order. A failed
 * bulk: what the server applied ends in post, the rest in postError (ordered: before the first failure).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  type BulkOperationResult,
  BulkWriteError,
  Entity,
  HOOK_EVENTS,
  type HookEvent,
  type OperationHookContext,
  Plugin,
  Post,
  PostError,
  Pre,
  Prop,
  QueryError,
  Schema,
  type SchemaPlugin,
  ValidationError,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("bw_hooks");

/** The recorded `phase event[#index]` lines. */
const seen: string[] = [];

/** A plugin subscribed to every hook event in every phase; query hooks of a bulk's operation add `#index`. */
const recorder: SchemaPlugin = {
  name: "bulk-recorder",
  apply: (builder) => {
    for (const phase of ["pre", "post", "postError"] as const) {
      for (const event of HOOK_EVENTS) {
        builder.addHook(phase, [event] as HookEvent[], function (this: unknown) {
          const index = event.startsWith("query.") ? (this as OperationHookContext<unknown>).bulkIndex : undefined;
          seen.push(`${phase} ${event}${index === undefined ? "" : `#${index}`}`);
        });
      }
    }
  },
};

@Plugin(recorder)
@Schema({ collection: "bw_accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0 }) balance?: number;
  @Prop(() => String) stamp?: string;

  @Pre("document.save") mark(this: Account): void {
    this.stamp = `saved:${this.owner}`;
  }
}

/** What the query hooks of `Ledger` saw. */
const ledger: { filter?: unknown; index?: number | undefined; result?: unknown } = {};

/** Only query hooks (no document hook): the inserts keep the plain path. */
@Schema({ collection: "bw_ledgers" })
class Ledger extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String) note?: string;

  @Pre("query.updateOne") stampUpdate(this: OperationHookContext<Ledger, "query.updateOne">): void {
    ledger.filter = this.filter;
    ledger.index = this.bulkIndex;
    this.modify({ update: { $set: { note: "hooked" } } });
  }

  @Post("query.updateOne") afterUpdate(
    this: OperationHookContext<Ledger, "query.updateOne">,
    result: BulkOperationResult | object,
  ): void {
    ledger.result = result;
  }

  @Pre("query.deleteMany") refuse(this: OperationHookContext<Ledger, "query.deleteMany">): void {
    this.skip({ acknowledged: true, deletedCount: 0 });
  }
}

/** The bulk positions whose postError hook ran for `Sku`. */
const refused: (number | undefined)[] = [];

/** A model whose update hook refuses some operations of a bulk. */
@Schema({ collection: "bw_skus" })
class Sku extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number) qty?: number;

  @PostError("query.updateOne") failedHook(this: OperationHookContext<Sku, "query.updateOne">): void {
    refused.push(this.bulkIndex);
  }

  @Pre("query.updateOne") reserve(this: OperationHookContext<Sku, "query.updateOne">): void {
    const filter = this.filter as { sku?: string } | undefined;
    if (this.bulkIndex !== undefined && filter?.sku?.startsWith("X-")) throw new Error(`sku ${filter.sku} is reserved`);
  }
}

/** The document events one created document leaves. */
const CREATED = ["pre document.save", "pre document.validate", "post document.validate", "post document.save"];

/**
 * The model of `Account`.
 * @returns The model.
 */
const accounts = () => t.connection.model(Account);

beforeEach(async () => {
  await t.mongo.db.collection("bw_accounts").deleteMany({});
  await t.mongo.db.collection("bw_ledgers").deleteMany({});
  seen.length = 0;
  for (const key of Object.keys(ledger)) delete ledger[key as keyof typeof ledger];
});

describe("every operation fires the hooks of its standalone counterpart", () => {
  test("insertOne: the document hooks of Model.insertOne; the pre-save change is stored", async () => {
    const result = await accounts().bulkWrite([{ insertOne: { document: { owner: "a" } } }]);
    expect(result.insertedCount).toBe(1);
    expect(seen).toEqual([
      "pre document.save",
      "pre document.validate",
      "post document.validate",
      "pre model.bulkWrite",
      "post model.bulkWrite",
      "post document.save",
    ]);
    expect(seen.filter((line) => line.includes("document."))).toEqual(CREATED);
    const stored = await t.mongo.db.collection("bw_accounts").findOne({ owner: "a" });
    expect(stored?.stamp).toBe("saved:a");
    expect(stored?._id).toEqual(result.insertedIds[0] as ObjectId);
  });

  test("updates, replaces and deletes: their query hooks in order; an upsert fires no document hook", async () => {
    await t.mongo.db.collection("bw_accounts").insertMany([{ owner: "x" }, { owner: "y" }, { owner: "z" }]);
    await accounts().bulkWrite([
      { updateOne: { filter: { owner: "x" }, update: { $set: { balance: 1 } } } },
      { updateOne: { filter: { owner: "new" }, update: { $set: { balance: 2 } }, upsert: true } },
      { replaceOne: { filter: { owner: "y" }, replacement: { owner: "y2" } } },
      { updateMany: { filter: { owner: { $ne: "none" } }, update: { $set: { stamp: "m" } } } },
      { deleteOne: { filter: { owner: "z" } } },
      { deleteMany: { filter: { owner: "none" } } },
    ]);
    expect(seen).toEqual([
      "pre query.updateOne#0",
      "pre query.updateOne#1",
      "pre query.replaceOne#2",
      "pre query.updateMany#3",
      "pre query.deleteOne#4",
      "pre query.deleteMany#5",
      "pre model.bulkWrite",
      "post model.bulkWrite",
      "post query.updateOne#0",
      "post query.updateOne#1",
      "post query.replaceOne#2",
      "post query.updateMany#3",
      "post query.deleteOne#4",
      "post query.deleteMany#5",
    ]);
    expect(await t.mongo.db.collection("bw_accounts").countDocuments({ owner: "new" })).toBe(1);
  });

  test("an upsert missing a required field is refused before the server, as a standalone upsert", async () => {
    const error = await accounts()
      .bulkWrite([{ updateOne: { filter: { balance: 5 }, update: { $set: { stamp: "s" } }, upsert: true } }])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(seen).toEqual(["postError model.bulkWrite", "postError query.updateOne#0"]);
    expect(await t.mongo.db.collection("bw_accounts").countDocuments()).toBe(0);
  });

  test("a mixed bulk: document pre hooks, operation pre hooks, the bulk's; then the bulk's post and per operation", async () => {
    await t.mongo.db.collection("bw_accounts").insertOne({ owner: "old" });
    await accounts().bulkWrite([
      { deleteOne: { filter: { owner: "old" } } },
      { insertOne: { document: { owner: "b" } } },
    ]);
    expect(seen).toEqual([
      "pre document.save",
      "pre document.validate",
      "post document.validate",
      "pre query.deleteOne#0",
      "pre model.bulkWrite",
      "post model.bulkWrite",
      "post query.deleteOne#0",
      "post document.save",
    ]);
  });
});

describe("this of an operation's query hook", () => {
  test("filter in database form, bulkIndex, modify changes the operation; post gets the operation's result", async () => {
    const Ledgers = t.connection.model(Ledger);
    const result = await Ledgers.bulkWrite([
      { insertOne: { document: { name: "a" } } },
      { updateOne: { filter: { name: "b" }, update: { $set: { name: "b" } }, upsert: true } },
    ]);
    expect(ledger.filter).toEqual({ name: "b" });
    expect(ledger.index).toBe(1);
    expect(ledger.result).toEqual({
      acknowledged: true,
      matchedCount: null,
      modifiedCount: null,
      upsertedCount: 1,
      upsertedId: result.upsertedIds[1],
    });
    const stored = await t.mongo.db.collection("bw_ledgers").findOne({ name: "b" });
    expect(stored?.note).toBe("hooked");
    /* The insert kept the plain path (no document hook): stored as given. */
    expect(await t.mongo.db.collection("bw_ledgers").findOne({ name: "a" })).not.toHaveProperty("note");
  });

  test("a standalone call: bulkIndex is undefined, the post hook gets the UpdateResult", async () => {
    await t.connection.model(Ledger).updateOne({ name: "c" }, { $set: { name: "c" } }, { upsert: true });
    expect(ledger.index).toBeUndefined();
    expect(ledger.result).toMatchObject({ matchedCount: 0, upsertedCount: 1 });
  });

  test("skip() of one operation is refused: the bulk fails, nothing is written", async () => {
    const error = await t.connection
      .model(Ledger)
      .bulkWrite([{ insertOne: { document: { name: "d" } } }, { deleteMany: { filter: { name: "d" } } }])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as Error).message).toContain("Ledger.deleteMany (bulkWrite[1]): skip() cannot replace");
    expect(await t.mongo.db.collection("bw_ledgers").countDocuments()).toBe(0);
  });
});

describe("a bulk that fails", () => {
  test("ordered, failing on the server at operation 2: 0 and 1 end in post, 2 and 3 in postError", async () => {
    const taken = new ObjectId();
    await t.mongo.db.collection("bw_accounts").insertOne({ _id: taken, owner: "taken" });
    const error = await accounts()
      .bulkWrite([
        { insertOne: { document: { owner: "p" } } },
        { updateOne: { filter: { owner: "taken" }, update: { $set: { balance: 3 } } } },
        { insertOne: { document: { _id: taken, owner: "dup" } } },
        { deleteOne: { filter: { owner: "p" } } },
      ])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BulkWriteError);
    expect((error as BulkWriteError).writeErrors.map((failure) => failure.index)).toEqual([2]);
    expect(seen.filter((line) => !line.startsWith("pre") && !line.includes("validate"))).toEqual([
      "postError model.bulkWrite",
      "post document.save",
      "post query.updateOne#1",
      "postError document.save",
      "postError query.deleteOne#3",
    ]);
    /* Operation 3 was not attempted: "p" stays. */
    expect(await t.mongo.db.collection("bw_accounts").countDocuments({ owner: "p" })).toBe(1);
  });

  test("unordered: only the failed operation ends in postError", async () => {
    const taken = new ObjectId();
    await t.mongo.db.collection("bw_accounts").insertOne({ _id: taken, owner: "taken" });
    const error = await accounts()
      .bulkWrite(
        [
          { insertOne: { document: { _id: taken, owner: "dup" } } },
          { insertOne: { document: { owner: "q" } } },
          { deleteOne: { filter: { owner: "taken" } } },
        ],
        { ordered: false },
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BulkWriteError);
    expect(seen.filter((line) => !line.startsWith("pre") && !line.includes("validate"))).toEqual([
      "postError model.bulkWrite",
      "postError document.save",
      "post document.save",
      "post query.deleteOne#2",
    ]);
  });

  test("an invalid insert of an ordered bulk: nothing is sent, every hook ends in postError", async () => {
    await t.mongo.db.collection("bw_accounts").insertOne({ owner: "r" });
    const error = await accounts()
      .bulkWrite([{ deleteOne: { filter: { owner: "r" } } }, { insertOne: { document: { owner: "s", balance: -1 } } }])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(seen).toEqual([
      "pre document.save",
      "pre document.validate",
      "postError document.validate",
      "postError model.bulkWrite",
      "postError query.deleteOne#0",
      "postError document.save",
    ]);
    expect(await t.mongo.db.collection("bw_accounts").countDocuments({ owner: "r" })).toBe(1);
  });
});

describe("an error thrown by the pre hook of one operation", () => {
  /**
   * Three upserts, the second of which the hook refuses.
   * @returns The operations.
   */
  const upserts = () =>
    ["A", "X-1", "D"].map((sku) => ({
      updateOne: { filter: { sku }, update: { $set: { qty: 1 } }, upsert: true },
    }));

  test("unordered: it is a writeError at its index, the other operations are written", async () => {
    await t.mongo.db.collection("bw_skus").deleteMany({});
    refused.length = 0;
    const error = await t.connection
      .model(Sku)
      .bulkWrite(upserts(), { ordered: false })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BulkWriteError);
    const failures = (error as BulkWriteError).writeErrors;
    expect(failures.map((failure) => failure.index)).toEqual([1]);
    const failure = failures[0] as (typeof failures)[number];
    expect(failure.code).toBeUndefined();
    expect((failure.error.cause as Error).message).toBe("sku X-1 is reserved");
    expect(failure.error.message).toContain("Sku.updateOne (bulkWrite[1]): a pre hook threw: sku X-1 is reserved");
    expect((error as BulkWriteError).ordered).toBe(false);
    /* the refused operation ends in postError, the written ones in post */
    expect(refused).toEqual([1]);
    expect((error as BulkWriteError).result.upsertedCount).toBe(2);
    expect((await t.mongo.db.collection("bw_skus").find().sort({ sku: 1 }).toArray()).map((doc) => doc.sku)).toEqual([
      "A",
      "D",
    ]);
  });

  test("ordered: the bulk stops with the error of the hook, nothing is written", async () => {
    await t.mongo.db.collection("bw_skus").deleteMany({});
    const error = await t.connection
      .model(Sku)
      .bulkWrite(upserts())
      .catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(BulkWriteError);
    expect((error as Error).message).toBe("sku X-1 is reserved");
    expect(await t.mongo.db.collection("bw_skus").countDocuments()).toBe(0);
  });
});
