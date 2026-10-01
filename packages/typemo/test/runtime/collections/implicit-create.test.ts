/*
 * On the real server: a collection whose schema has options MongoDB takes only at creation (capped, time series,
 * clustered, collation) is never created implicitly as a plain collection. The first write that could create it
 * (insert, create, bulkWrite, upsert) and the index commands of a missing collection are a `ConfigurationError`
 * that says to call `connection.init()` or `ensureCollection()`; the check runs once per model. Models without such
 * options write as before. `createCollection()` respects `autoCreate: false`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ConfigurationError, Entity, Index, Prop, Schema } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A capped log. */
@Schema({ collection: "ic_logs", capped: { size: 4096 } })
@Index({ line: 1 })
class Log extends Entity {
  @Prop(() => String) line?: string;
}

/** A collection with a collation. */
@Schema({ collection: "ic_names", collation: { locale: "en", strength: 2 } })
class Name extends Entity {
  @Prop(() => String) name?: string;
}

/** A collection created elsewhere. */
@Schema({ collection: "ic_owned", autoCreate: false })
class Owned extends Entity {
  @Prop(() => String) name?: string;
}

/** A capped collection created elsewhere, with no index: nothing for init() to do. */
@Schema({ collection: "ic_owned_capped", capped: { size: 4096 }, autoCreate: false })
class OwnedCapped extends Entity {
  @Prop(() => String) note?: string;
}

/** The same with an index: init() would create the collection through the index, so it says so. */
@Schema({ collection: "ic_owned_indexed", capped: { size: 4096 }, autoCreate: false })
@Index({ note: 1 })
class OwnedIndexed extends Entity {
  @Prop(() => String) note?: string;
}

/** A plain collection: created by the first write, as always. */
@Schema({ collection: "ic_plain" })
class Plain extends Entity {
  @Prop(() => String) name?: string;
}

const t = ModelLifecycle.useTypemo("ic");

/**
 * The stored options of a collection.
 * @param name The collection name.
 * @returns The options, or undefined when the collection does not exist.
 */
const stored = async (name: string) =>
  ((await t.mongo.db.listCollections({ name }).toArray())[0] as { options?: Record<string, unknown> } | undefined)
    ?.options;

/**
 * Awaits an operation that must fail with the "create it first" error.
 * @param run The operation.
 * @returns The error.
 */
const missing = async (run: () => PromiseLike<unknown>): Promise<ConfigurationError> => {
  const error = await Promise.resolve()
    .then(run)
    .then(
      () => undefined,
      (caught: unknown) => caught,
    );
  expect(error).toBeInstanceOf(ConfigurationError);
  expect((error as Error).message).toContain("connection.init()");
  return error as ConfigurationError;
};

beforeEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray())
    await t.mongo.db.dropCollection(name);
});

describe("a collection with creation-only options is not created by a write", () => {
  test("create, insertMany, bulkWrite and an upsert are refused; nothing is created", async () => {
    const Logs = t.connection.model(Log);
    const error = await missing(() => Logs.create({ line: "a" }));
    expect(error.message).toContain("capped");
    await missing(() => Logs.insertMany([{ line: "a" }]));
    await missing(() => Logs.bulkWrite([{ insertOne: { document: { line: "a" } } }]));
    await missing(() => t.connection.model(Name).updateOne({ name: "a" }, { $set: { name: "b" } }, { upsert: true }));
    expect(await stored("ic_logs")).toBeUndefined();
    expect(await stored("ic_names")).toBeUndefined();
  });

  test("syncIndexes and createIndexes of a missing collection are refused too", async () => {
    const Logs = t.connection.model(Log);
    await missing(() => Logs.syncIndexes());
    await missing(() => Logs.createIndexes());
    expect(await stored("ic_logs")).toBeUndefined();
  });

  test("after connection.init() the writes work and keep the options", async () => {
    const Logs = t.connection.model(Log);
    t.connection.model(Name);
    await t.connection.init();
    await Logs.create({ line: "a" });
    expect(await stored("ic_logs")).toMatchObject({ capped: true, size: 4096 });
    expect(
      (await t.connection.model(Name).updateOne({ name: "a" }, { $set: { name: "b" } }, { upsert: true }))
        .upsertedCount,
    ).toBe(1);
  });

  test("the check runs once per model: later writes send no listCollections", async () => {
    const Logs = t.connection.model(Log);
    await Logs.ensureCollection();
    t.commands.clear();
    await Logs.create({ line: "a" });
    await Logs.create({ line: "b" });
    await Logs.insertMany([{ line: "c" }]);
    expect(t.commands.byName("listCollections").length).toBeLessThanOrEqual(1);
  });

  test("a model without such options is created by its first write, with no check", async () => {
    t.commands.clear();
    await t.connection.model(Plain).create({ name: "a" });
    expect(await stored("ic_plain")).toBeDefined();
    expect(t.commands.byName("listCollections").length).toBe(0);
  });
});

describe("autoCreate: false", () => {
  test("createCollection() does not create the collection", async () => {
    const error = await t.connection
      .model(Owned)
      .createCollection()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toContain("autoCreate: false");
    expect(await stored("ic_owned")).toBeUndefined();
  });

  test("init() and syncAll() skip a schema with autoCreate: false and nothing to create", async () => {
    t.connection.model(OwnedCapped);
    await t.connection.init();
    await t.connection.syncAll();
    expect(await stored("ic_owned_capped")).toBeUndefined();
  });

  test("init() still fails for autoCreate: false when an index would create the collection", async () => {
    t.connection.model(OwnedIndexed);
    const error = await t.connection.init().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toContain("ic_owned_indexed");
    expect(await stored("ic_owned_indexed")).toBeUndefined();
  });
});
