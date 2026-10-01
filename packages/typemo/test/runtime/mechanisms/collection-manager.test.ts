/*
 * `createCollection` on the real server with every schema option (capped, time series,
 * clustered + TTL, validator, collation, pre/post images), what the server stores, validator rejection,
 * `ensureCollection` (created / unchanged / updated by collMod / dryRun / immutable differences), and the
 * explicit "already exists" semantics.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  CollectionManager,
  CollectionOptionsError,
  ConfigurationError,
  Entity,
  Index,
  Prop,
  Schema,
  SchemaCompiler,
} from "../../../src/internal.ts";
import {
  CappedLog,
  Collated,
  Imaged,
  Reading,
  TimedEvent,
  Validated,
} from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("s9_collections");

/**
 * The `listCollections` entry of a collection.
 * @param name The collection name.
 * @returns The entry with its type and options, or undefined when it does not exist.
 */
const info = async (name: string) =>
  (await t.mongo.db.listCollections({ name }).toArray())[0] as
    | { type?: string; options?: Record<string, unknown> }
    | undefined;

beforeEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("s9_")) await t.mongo.db.dropCollection(name);
  }
});

describe("createCollection: every option from the schema", () => {
  test("capped: size and max", async () => {
    expect(await t.connection.model(CappedLog).createCollection()).toBe(true);
    expect((await info("s9_logs"))?.options).toMatchObject({ capped: true, size: 4096, max: 3 });
    const Logs = t.connection.model(CappedLog);
    for (const line of ["a", "b", "c", "d"]) await Logs.create({ line });
    /* A capped collection keeps the last `max` documents in insertion order. */
    expect((await Logs.find().lean()).map((doc) => doc.line)).toEqual(["b", "c", "d"]);
  });

  test("time series: fields in database names, granularity, TTL at the top level", async () => {
    expect(await t.connection.model(Reading).createCollection()).toBe(true);
    const stored = await info("s9_readings");
    expect(stored?.type).toBe("timeseries");
    /* int64 on the server (a bigint with useBigInt64). */
    expect(Number(stored?.options?.expireAfterSeconds)).toBe(3600);
    expect(stored?.options?.timeseries).toMatchObject({ timeField: "at", metaField: "sensor", granularity: "seconds" });
    const Readings = t.connection.model(Reading);
    await Readings.create({ at: new Date("2026-01-01T00:00:00Z"), sensor: "s1", value: 1 });
    expect(await Readings.countDocuments({ sensor: "s1" })).toBe(1);
  });

  test("clustered: the clustered index with its name and the collection TTL", async () => {
    expect(await t.connection.model(TimedEvent).createCollection()).toBe(true);
    const stored = (await info("s9_events"))?.options;
    expect(stored?.clusteredIndex).toMatchObject({ key: { _id: 1 }, unique: true, name: "by_time" });
    expect(Number(stored?.expireAfterSeconds)).toBe(60);
    expect((await t.connection.model(TimedEvent).ensureCollection()).result).toBe("unchanged");
    const Events = t.connection.model(TimedEvent);
    await Events.create({ _id: new Date("2026-01-01T00:00:00Z"), kind: "boot" });
    expect(await Events.countDocuments({})).toBe(1);
  });

  test("validator: the generated $jsonSchema is on the server and rejects a bad document", async () => {
    expect(await t.connection.model(Validated).createCollection()).toBe(true);
    const stored = await info("s9_validated");
    expect(stored?.options?.validationLevel).toBe("strict");
    expect(stored?.options?.validationAction).toBe("error");
    expect((stored?.options?.validator as { $jsonSchema: unknown } | undefined)?.$jsonSchema).toMatchObject({
      bsonType: "object",
      required: expect.arrayContaining(["_id", "name"]),
      additionalProperties: false,
    });
    /* A write that bypasses Typemo's validation (the raw driver) is refused by the server. */
    const error = await t.mongo.db
      .collection("s9_validated")
      .insertOne({ name: "x", age: -1 })
      .catch((caught: unknown) => caught);
    expect((error as { code?: number }).code).toBe(121);
    /* A field the schema does not know is refused too (additionalProperties: false). */
    const Validateds = t.connection.model(Validated);
    await Validateds.create({ name: "ok", age: 1 });
    const raw = await t.mongo.db
      .collection("s9_validated")
      .updateOne({ name: "ok" }, { $set: { extra: 1 } })
      .catch((caught: unknown) => caught);
    expect((raw as { code?: number }).code).toBe(121);
  });

  test("collation: the collection default is used by queries and inherited by indexes", async () => {
    const Collateds = t.connection.model(Collated);
    expect(await Collateds.createCollection()).toBe(true);
    expect((await info("s9_collated"))?.options?.collation).toMatchObject({ locale: "en", strength: 2 });
    await Collateds.create({ name: "Ann" });
    expect(await Collateds.countDocuments({ name: "ann" })).toBe(1);
  });

  test("changeStreamPreAndPostImages", async () => {
    expect(await t.connection.model(Imaged).createCollection()).toBe(true);
    expect((await info("s9_imaged"))?.options?.changeStreamPreAndPostImages).toEqual({ enabled: true });
  });

  test("the options are derived without touching the schema (frozen)", () => {
    const options = CollectionManager.optionsOf(SchemaCompiler.compileModel(Reading));
    expect(Object.isFrozen(options)).toBe(true);
    expect(options).toEqual({
      timeseries: { timeField: "at", metaField: "sensor", granularity: "seconds" },
      expireAfterSeconds: 3600,
    });
  });
});

describe("already exists: explicit", () => {
  test("the same options: false; other options: CollectionOptionsError naming them", async () => {
    const Logs = t.connection.model(CappedLog);
    expect(await Logs.createCollection()).toBe(true);
    expect(await Logs.createCollection()).toBe(false);
    await t.mongo.db.dropCollection("s9_logs");
    await t.mongo.db.createCollection("s9_logs");
    const error = await Logs.createCollection().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CollectionOptionsError);
    expect((error as CollectionOptionsError).differences.map((difference) => difference.option)).toEqual(["capped"]);
  });

  test("one text for options MongoDB cannot change: createCollection() and ensureCollection() say the same", async () => {
    const Logs = t.connection.model(CappedLog);
    await t.mongo.db.createCollection("s9_logs");
    const created = (await Logs.createCollection().catch((caught: unknown) => caught)) as Error;
    const ensured = (await Logs.ensureCollection({ update: true }).catch((caught: unknown) => caught)) as Error;
    const text =
      'collection "s9_logs": exists with options MongoDB cannot change (capped): drop the collection and create it again';
    expect(created.message).toBe(text);
    expect(ensured.message).toBe(text);
  });

  test("a view under the collection's name is an error, never a success", async () => {
    await t.mongo.db.createCollection("s9_logs", { viewOn: "elsewhere", pipeline: [] });
    const error = await t.connection
      .model(CappedLog)
      .createCollection()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CollectionOptionsError);
    expect(String((error as Error).message)).toContain("view");
  });

  test("a regular collection where a time series is declared (and back)", async () => {
    await t.mongo.db.createCollection("s9_readings");
    const error = await t.connection
      .model(Reading)
      .ensureCollection()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CollectionOptionsError);
    expect(String((error as Error).message)).toContain("time series");
  });
});

describe("ensureCollection (collMod)", () => {
  test("created, then unchanged", async () => {
    const Validateds = t.connection.model(Validated);
    expect((await Validateds.ensureCollection()).result).toBe("created");
    expect(await Validateds.ensureCollection()).toEqual({ result: "unchanged", differences: [] });
  });

  test("dryRun of a missing collection creates nothing", async () => {
    expect((await t.connection.model(Validated).ensureCollection({ dryRun: true })).result).toBe("created");
    expect(await info("s9_validated")).toBeUndefined();
  });

  test("a mutable difference: an error without update, reported by dryRun, changed by collMod with update", async () => {
    await t.mongo.db.createCollection("s9_validated", { validator: { $jsonSchema: { bsonType: "object" } } });
    const Validateds = t.connection.model(Validated);
    const error = await Validateds.ensureCollection().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CollectionOptionsError);
    const dry = await Validateds.ensureCollection({ dryRun: true });
    expect(dry.result).toBe("updated");
    /* The server keeps level "strict" and action "error" by default: only the validator differs. */
    expect(dry.differences.map((difference) => [difference.option, difference.mutable])).toEqual([["validator", true]]);
    expect((await Validateds.ensureCollection({ update: true })).result).toBe("updated");
    expect((await Validateds.ensureCollection()).result).toBe("unchanged");
    expect(
      ((await info("s9_validated"))?.options?.validator as { $jsonSchema: { required: string[] } } | undefined)
        ?.$jsonSchema.required,
    ).toContain("name");
  });

  test("capped size and max are changed in place", async () => {
    await t.mongo.db.createCollection("s9_logs", { capped: true, size: 8192, max: 10 });
    const report = await t.connection.model(CappedLog).ensureCollection({ update: true });
    expect(report.differences.map((difference) => difference.option)).toEqual(["size", "max"]);
    expect((await info("s9_logs"))?.options).toMatchObject({ capped: true, size: 4096, max: 3 });
  });

  test("time series granularity and TTL are changed in place; the time field cannot be", async () => {
    await t.mongo.db.createCollection("s9_readings", {
      timeseries: { timeField: "at", metaField: "sensor", granularity: "seconds" },
      expireAfterSeconds: 60,
    });
    const report = await t.connection.model(Reading).ensureCollection({ update: true });
    expect(report.differences.map((difference) => difference.option)).toEqual(["expireAfterSeconds"]);
    expect(Number((await info("s9_readings"))?.options?.expireAfterSeconds)).toBe(3600);
    await t.mongo.db.dropCollection("s9_readings");
    await t.mongo.db.createCollection("s9_readings", { timeseries: { timeField: "when", metaField: "sensor" } });
    const error = await t.connection
      .model(Reading)
      .ensureCollection({ update: true })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CollectionOptionsError);
    expect(
      (error as CollectionOptionsError).differences.find((difference) => difference.option === "timeseries.timeField"),
    ).toMatchObject({ mutable: false, wanted: "at", actual: "when" });
  });

  test("pre/post images are switched with collMod; a collation difference cannot be", async () => {
    await t.mongo.db.createCollection("s9_imaged");
    expect((await t.connection.model(Imaged).ensureCollection({ update: true })).result).toBe("updated");
    expect((await info("s9_imaged"))?.options?.changeStreamPreAndPostImages).toEqual({ enabled: true });
    await t.mongo.db.createCollection("s9_collated", { collation: { locale: "fr" } });
    const error = await t.connection
      .model(Collated)
      .ensureCollection({ update: true })
      .catch((caught: unknown) => caught);
    expect((error as CollectionOptionsError).differences.map((difference) => difference.option)).toEqual(["collation"]);
  });

  test("the server's expanded collation equals the schema's short one (no false difference)", async () => {
    await t.connection.model(Collated).createCollection();
    expect((await t.connection.model(Collated).ensureCollection()).result).toBe("unchanged");
  });
});

describe("schema checks of the collection options (build errors)", () => {
  test("clustered with capped, time series with clustered, a clustered TTL without a Date _id", () => {
    @Schema({ collection: "s9_bad1", clustered: true, capped: { size: 4096 } })
    class ClusteredCapped extends Entity {}
    expect(() => SchemaCompiler.compileModel(ClusteredCapped)).toThrow(ConfigurationError);

    @Schema({ collection: "s9_bad2", clustered: { expireAfterSeconds: 10 } })
    class ClusteredTtl extends Entity {}
    expect(() => SchemaCompiler.compileModel(ClusteredTtl)).toThrow("needs a Date _id");
  });

  test("time series buckets must be set together and equal (the server's rule)", () => {
    @Schema({ collection: "s9_bad3", timeseries: { timeField: "at", bucketMaxSpanSeconds: 100 } })
    class Buckets {
      @Prop(() => Date, { required: true })
      _id!: Date;

      @Prop(() => Date, { required: true })
      at!: Date;
    }
    expect(() => SchemaCompiler.compileModel(Buckets)).toThrow("must both be set and equal");
  });

  test("capped size must be a positive integer", () => {
    @Schema({ collection: "s9_bad4", capped: { size: 0 } })
    class Zero extends Entity {}
    expect(() => SchemaCompiler.compileModel(Zero)).toThrow("capped.size");
  });
});

describe("undeclared server options and collation checks", () => {
  @Schema({ collection: "s9_m9_plain" })
  class M9Plain extends Entity {
    @Prop(() => String, { required: true }) name!: string;
  }

  test("a validator the schema does not declare is a difference (strict): error without update, removed with it", async () => {
    await t.mongo.db.createCollection("s9_m9_plain", { validator: { $jsonSchema: { bsonType: "object" } } });
    const Plains = t.connection.model(M9Plain);
    const error = await Plains.ensureCollection().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CollectionOptionsError);
    expect((error as CollectionOptionsError).differences.map((difference) => difference.option)).toContain("validator");
    expect((await Plains.ensureCollection({ update: true })).result).toBe("updated");
    expect((await info("s9_m9_plain"))?.options?.validator ?? {}).toEqual({});
  });

  test("pre/post images the schema does not declare are a difference too", async () => {
    await t.mongo.db.createCollection("s9_m9_plain", { changeStreamPreAndPostImages: { enabled: true } });
    const error = await t.connection
      .model(M9Plain)
      .ensureCollection()
      .catch((caught: unknown) => caught);
    expect((error as CollectionOptionsError).differences.map((difference) => difference.option)).toContain(
      "changeStreamPreAndPostImages",
    );
  });

  test("a 2d index in a collection with a collation is a build error unless it declares simple", () => {
    @Schema({ collection: "s9_m10_geo", collation: { locale: "en" } })
    @Index({ at: "2d" })
    class Geo extends Entity {
      @Prop(() => [Number]) at?: number[];
    }
    expect(() => SchemaCompiler.compileModel(Geo)).toThrow(/a 2d index cannot have a collation/);

    @Schema({ collection: "s9_m10_geo_ok", collation: { locale: "en" } })
    @Index({ at: "2d" }, { collation: { locale: "simple" } })
    class GeoOk extends Entity {
      @Prop(() => [Number]) at?: number[];
    }
    expect(() => SchemaCompiler.compileModel(GeoOk)).not.toThrow();
  });
});
