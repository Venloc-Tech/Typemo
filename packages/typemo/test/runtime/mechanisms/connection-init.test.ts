/*
 * `await connection.init()` explicitly creates what the models need and the database lacks —
 * collections (with schema options), indexes — and nothing else: no drops, no changes (a difference is a failure,
 * `syncAll()` replaces it). It is never automatic: registering a model or running an operation creates no index.
 */
import { describe, expect, test } from "bun:test";
import { Entity, Index, IndexSyncError, Prop, Schema, SyncError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A capped collection with a unique index and a field index. */
@Index({ sku: 1 }, { unique: true, name: "sku_unique" })
@Schema({ collection: "m8_products", capped: { size: 65_536 } })
class Product extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { index: true }) price?: number;
}

const t = ModelLifecycle.useTypemo("m8_init");
/**
 * The `listCollections` entries of the products collection.
 * @returns Zero or one entry.
 */
const collections = async () =>
  (await t.mongo.db.listCollections({}, { nameOnly: false }).toArray()).filter((info) => info.name === "m8_products");
/**
 * The sorted index names of the products collection.
 * @returns The names.
 */
const indexNames = async () =>
  (await t.mongo.db.collection("m8_products").listIndexes().toArray()).map((index) => index.name as string).sort();

describe("connection.init()", () => {
  test("never automatic: model() and a read create nothing", async () => {
    const Products = t.connection.model(Product);
    await Products.find().lean();
    expect(await collections()).toEqual([]);
  });

  test("creates the missing collection (with its options) and indexes; a second init() has nothing to do", async () => {
    t.connection.model(Product);
    const report = await t.connection.init();
    const [info] = await collections();
    expect((info as { options?: { capped?: boolean } } | undefined)?.options?.capped).toBe(true);
    expect(await indexNames()).toEqual(["_id_", "price_1", "sku_unique"]);
    expect(report.failed).toBe(false);
    const product = report.collections.find((entry) => entry.collection === "m8_products");
    expect(product?.options?.result).toBe("created");
    expect([...(product?.indexes?.toCreate ?? [])].sort()).toEqual(["price_1", "sku_unique"]);
    /* After creating what was missing the database matches the models: in sync, with the list of what was made. */
    expect(report.inSync).toBe(true);
    expect([...report.created].sort()).toEqual([
      "collection m8_products",
      "index m8_products.price_1",
      "index m8_products.sku_unique",
    ]);
    const again = await t.connection.init();
    expect(again.inSync).toBe(true);
    expect(again.created).toEqual([]);
    const second = again.collections.find((entry) => entry.collection === "m8_products");
    expect(second?.options?.result).toBe("unchanged");
    expect(second?.indexes?.toCreate).toEqual([]);
  });

  test("an index the schema does not declare stays (init never drops)", async () => {
    t.connection.model(Product);
    await t.connection.init();
    await t.mongo.db.collection("m8_products").createIndex({ extra: 1 }, { name: "extra_1" });
    await t.connection.init();
    expect(await indexNames()).toContain("extra_1");
  });

  test("an index declared differently: init() rejects (every failure listed) and changes nothing", async () => {
    t.connection.model(Product);
    await t.connection.init();
    await t.mongo.db.collection("m8_products").dropIndex("sku_unique");
    await t.mongo.db.collection("m8_products").createIndex({ sku: -1 }, { name: "sku_unique" });
    const error = await t.connection.init().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).operation).toBe("connection.init");
    expect((error as Error).message).toContain('index "sku_unique" exists on the server with other keys or options');
    /* The model is named once: the index error's own "Product: " prefix is not repeated. */
    expect((error as Error).message).toContain(
      'collection "m8_products": Product: 1 index operation(s) failed: create sku_unique: index "sku_unique" exists',
    );
    expect((error as Error).message.match(/Product: /g)?.length).toBe(1);
    expect((error as Error).cause).toBeInstanceOf(AggregateError);
    expect((error as SyncError).failures).toEqual([
      { kind: "collection", name: "m8_products", model: "Product", errors: (error as SyncError).errors },
    ]);
    expect((error as SyncError).errors[0]).toBeInstanceOf(IndexSyncError);
    expect((error as SyncError).report.failed).toBe(true);
    const index = (await t.mongo.db.collection("m8_products").listIndexes().toArray()).find(
      (candidate) => candidate.name === "sku_unique",
    );
    expect(index?.key).toEqual({ sku: -1 });
  });
});
