/*
 * `diffIndexes`/`syncIndexes` on the real server — symmetric collation (the collection default
 * inherited by an index, the server's expanded form), `unique`/`sparse: false` equal to absent, hidden
 * indexes and TTL changes by `collMod` (no rebuild), `dryRun`, every failure collected, the
 * clustered index left alone, search indexes on a server without search, and `syncAll` that never stops at
 * one model's failure (the old wrapper's did).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  CollectionOptionsError,
  type DuplicateKeyError,
  IndexSyncError,
  ServerError,
  SyncError,
} from "../../../src/index.ts";
import {
  CappedLog,
  Collated,
  Indexed,
  PlainIndexed,
  Searchable,
  TimedEvent,
  TwoUnique,
} from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("s9_indexes");

/**
 * Finds an index of a collection by name.
 * @param collection The collection name.
 * @param name The index name.
 * @returns The index description, or undefined.
 */
const indexNamed = async (collection: string, name: string) =>
  (await t.mongo.db.collection(collection).listIndexes().toArray()).find((index) => index.name === name);

beforeEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("s9_")) await t.mongo.db.dropCollection(name);
  }
});

describe("diffIndexes: exact comparison", () => {
  test("every kind of index created by the schema compares equal afterwards (collation, hidden, TTL, text)", async () => {
    const Indexeds = t.connection.model(Indexed);
    expect((await Indexeds.diffIndexes()).toCreate).toEqual(["email_1", "nick_1", "city_1", "seenAt_1", "bio_text"]);
    await Indexeds.syncIndexes();
    expect(await Indexeds.diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
    expect((await indexNamed("s9_indexed", "city_1"))?.hidden).toBe(true);
  });

  test("an index without a collation in a collection WITH a default collation inherits it: no false rebuild", async () => {
    const Collateds = t.connection.model(Collated);
    await Collateds.createCollection();
    await Collateds.syncIndexes();
    /* The server gave name_1 the collection's expanded collation and code_1 the explicit "simple" one. */
    expect((await indexNamed("s9_collated", "name_1"))?.collation).toMatchObject({ locale: "en", strength: 2 });
    expect(await Collateds.diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
  });

  test("a collation that differs in a field the schema sets (strength) is a rebuild", async () => {
    await t.mongo.db.collection("s9_indexed").createIndex({ nick: 1 }, { collation: { locale: "en", strength: 3 } });
    const diff = await t.connection.model(Indexed).diffIndexes();
    expect(diff.toDrop).toContain("nick_1");
    expect(diff.toCreate).toContain("nick_1");
  });

  test("a collation where the schema has none is a rebuild (and the other way round)", async () => {
    await t.mongo.db.collection("s9_plain_indexed").createIndex({ code: 1 }, { collation: { locale: "en" } });
    expect((await t.connection.model(PlainIndexed).diffIndexes()).toDrop).toEqual(["code_1"]);
    await t.mongo.db.dropCollection("s9_plain_indexed");
    await t.mongo.db.collection("s9_indexed").createIndex({ nick: 1 });
    expect((await t.connection.model(Indexed).diffIndexes()).toDrop).toContain("nick_1");
  });

  test("unique: false and sparse: false on the server equal an absent option (Mongoose Q-M1-7)", async () => {
    await t.mongo.db.collection("s9_plain_indexed").createIndex({ code: 1 }, { unique: false, sparse: false });
    expect((await indexNamed("s9_plain_indexed", "code_1"))?.sparse).toBe(false);
    expect(await t.connection.model(PlainIndexed).diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
  });

  test("hidden and a changed TTL are collMod changes, not rebuilds", async () => {
    const collection = t.mongo.db.collection("s9_indexed");
    await t.connection.model(Indexed).syncIndexes();
    await t.mongo.db.command({ collMod: "s9_indexed", index: { name: "city_1", hidden: false } });
    await t.mongo.db.command({ collMod: "s9_indexed", index: { name: "seenAt_1", expireAfterSeconds: 100 } });
    const Indexeds = t.connection.model(Indexed);
    const diff = await Indexeds.diffIndexes();
    expect(diff).toEqual({
      toCreate: [],
      toDrop: [],
      toModify: [
        { name: "city_1", hidden: true },
        { name: "seenAt_1", expireAfterSeconds: 300 },
      ],
    });
    const dry = await Indexeds.syncIndexes({ dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect((await indexNamed("s9_indexed", "city_1"))?.hidden).toBeUndefined();
    await Indexeds.syncIndexes();
    expect((await indexNamed("s9_indexed", "city_1"))?.hidden).toBe(true);
    expect(Number((await indexNamed("s9_indexed", "seenAt_1"))?.expireAfterSeconds)).toBe(300);
    expect((await collection.listIndexes().toArray()).length).toBe(6);
  });

  test("the clustered index of a clustered collection is never dropped", async () => {
    const Events = t.connection.model(TimedEvent);
    await Events.createCollection();
    expect(await Events.diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
    await Events.syncIndexes();
    expect((await t.mongo.db.collection("s9_events").listIndexes().toArray()).map((index) => index.name)).toEqual([
      "by_time",
    ]);
  });
});

describe("failures are collected", () => {
  test("both unique indexes fail on duplicated data: one IndexSyncError with both", async () => {
    await t.mongo.db.collection("s9_two_unique").insertMany([
      { a: "x", b: "y" },
      { a: "x", b: "y" },
    ]);
    const error = await t.connection
      .model(TwoUnique)
      .syncIndexes()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IndexSyncError);
    expect(
      (error as IndexSyncError).failures.map((failure) => [failure.name, failure.action, failure.error.name]),
    ).toEqual([
      ["a_1", "create", "DuplicateKeyError"],
      ["b_1", "create", "DuplicateKeyError"],
    ]);
    /* The index build's server text (identifiers, "Index build failed ... :: caused by ::") stays in serverMessage. */
    const first = (error as IndexSyncError).failures[0]?.error as DuplicateKeyError;
    expect(first.message).toMatch(/^duplicate key/);
    expect(first.message).not.toContain("caused by");
    expect(first.message).toEndWith("(code 11000 DuplicateKey)");
    expect(first.serverMessage).toContain("caused by");
  });
});

describe("search indexes (Atlas Search): not available on a plain mongod", () => {
  test("diffSearchIndexes and syncSearchIndexes report SearchNotEnabled (31082), never 'no indexes'", async () => {
    const Searchables = t.connection.model(Searchable);
    await Searchables.createCollection();
    const diffError = await Searchables.diffSearchIndexes().catch((caught: unknown) => caught);
    expect(diffError).toBeInstanceOf(ServerError);
    expect((diffError as ServerError).code).toBe(31082);
    const syncError = await Searchables.syncSearchIndexes({ dryRun: true }).catch((caught: unknown) => caught);
    expect((syncError as ServerError).code).toBe(31082);
  });
});

describe("syncAll over a connection", () => {
  test("one model's failure does not stop the others; dryRun writes nothing", async () => {
    const connection = t.client.db(`${t.mongo.dbName}_syncall`);
    connection.model(Indexed);
    connection.model(TwoUnique);
    connection.model(CappedLog);
    connection.model(Searchable);
    const db = t.mongo.client.db(`${t.mongo.dbName}_syncall`);
    await db.dropDatabase();
    await db.collection("s9_two_unique").insertMany([{ a: "x" }, { a: "x" }]);

    /* The dry run fails too (search indexes need Atlas): the report is in the SyncError; nothing is written. */
    const dryError = await connection.syncAll({ dryRun: true }).catch((caught: unknown) => caught);
    expect(dryError).toBeInstanceOf(SyncError);
    const dry = (dryError as SyncError).report;
    expect(dry.inSync).toBe(false);
    expect(dry.collections.map((entry) => entry.collection).sort()).toEqual([
      "s9_indexed",
      "s9_logs",
      "s9_searchable",
      "s9_two_unique",
    ]);
    expect((await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name)).toEqual([
      "s9_two_unique",
    ]);

    /* Every step ran; the failures come as one SyncError holding the whole report. */
    const error = await connection.syncAll().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SyncError);
    const report = (error as SyncError).report;
    expect(report.failed).toBe(true);
    expect((error as SyncError).operation).toBe("syncAll");
    expect((error as SyncError).failures.map((failure) => failure.name).sort()).toEqual([
      "s9_searchable",
      "s9_two_unique",
    ]);
    expect((error as Error).cause).toBeInstanceOf(AggregateError);
    expect(((error as Error).cause as AggregateError).errors).toEqual([...(error as SyncError).errors]);
    const byName = Object.fromEntries(report.collections.map((entry) => [entry.collection, entry]));
    expect(byName.s9_indexed?.errors).toEqual([]);
    expect(byName.s9_indexed?.options?.result).toBe("created");
    expect(byName.s9_indexed?.indexes?.toCreate.length).toBe(5);
    expect(byName.s9_logs?.options?.result).toBe("created");
    expect(byName.s9_two_unique?.errors.map((error) => error.name)).toEqual(["IndexSyncError"]);
    expect(byName.s9_searchable?.errors.map((error) => (error as ServerError).code)).toEqual([31082]);
    /* The failing model's other step (its collection) still ran, and the next models were synced. */
    expect(byName.s9_two_unique?.options?.result).toBe("unchanged");
    expect((await db.collection("s9_indexed").listIndexes().toArray()).length).toBe(6);
    await db.dropDatabase();
  });

  test("a collection option MongoDB cannot change fails that step only; the call throws SyncError", async () => {
    const connection = t.client.db(`${t.mongo.dbName}_syncall2`);
    connection.model(CappedLog);
    const db = t.mongo.client.db(`${t.mongo.dbName}_syncall2`);
    await db.dropDatabase();
    await db.createCollection("s9_logs");
    const error = await connection.syncAll({ update: true }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).errors[0]).toBeInstanceOf(CollectionOptionsError);
    /* The collection name is said once, and the reason is the one text of createCollection(). */
    expect((error as Error).message).toContain(
      'collection "s9_logs": exists with options MongoDB cannot change (capped): drop the collection and create it again',
    );
    expect((error as Error).message).not.toContain('collection "s9_logs": collection "s9_logs"');
    const report = (error as SyncError).report;
    expect(report.collections[0]?.errors[0]).toBeInstanceOf(CollectionOptionsError);
    expect(report.collections[0]?.indexes).toEqual({ toCreate: [], toDrop: [], toModify: [], dryRun: false });
    await db.dropDatabase();
  });
});
