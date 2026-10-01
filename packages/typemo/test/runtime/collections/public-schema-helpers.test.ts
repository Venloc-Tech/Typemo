/*
 * The schema-level helpers take what a user holds — a model or its `model.schema` — not the compiled internals:
 * `CollectionManager.optionsOf/create/ensure`, `JsonSchemaGenerator.generate/validator`, `StandardSchema.of`,
 * `SyncAll.collections`. Everything runs on the real server through the public entry only.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  type CollectionInfo,
  CollectionManager,
  ConfigurationError,
  JsonSchemaGenerator,
  type SchemaInfo,
  StandardSchema,
  SyncAll,
} from "../../../src/index.ts";
import { CappedLog, Validated } from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("w5_schema_helpers");

afterEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("s9_")) await t.mongo.db.dropCollection(name);
  }
});

describe("CollectionManager over a model", () => {
  test("optionsOf, create, ensure and info accept the model and its schema", async () => {
    const Logs = t.connection.model(CappedLog);
    expect(CollectionManager.optionsOf(Logs)).toMatchObject({ capped: true, size: 4096, max: 3 });
    expect(CollectionManager.optionsOf(Logs.schema)).toEqual(CollectionManager.optionsOf(Logs));

    expect(await CollectionManager.ensure(t.mongo.db, Logs, { dryRun: true })).toMatchObject({ result: "created" });
    expect(await CollectionManager.create(t.mongo.db, Logs)).toBe(true);
    expect(await CollectionManager.create(t.mongo.db, Logs.schema)).toBe(false);
    expect(await CollectionManager.ensure(t.mongo.db, Logs.schema)).toMatchObject({ result: "unchanged" });

    const stored: CollectionInfo | undefined = await CollectionManager.info(t.mongo.db, Logs.collectionName);
    expect(stored?.options).toMatchObject({ capped: true, size: 4096 });
    expect(
      CollectionManager.differences(Logs.collectionName, CollectionManager.optionsOf(Logs), stored as CollectionInfo),
    ).toEqual([]);
  });

  test("anything else is a ConfigurationError that names the call", () => {
    /* The wrong argument is the point of the test; the type system refuses it. */
    const foreign = { collection: "x", schema: {} } as never;
    expect(() => CollectionManager.optionsOf(foreign)).toThrow(ConfigurationError);
    expect(() => CollectionManager.optionsOf(foreign)).toThrow("CollectionManager.optionsOf");
    expect(() => JsonSchemaGenerator.generate(null as never)).toThrow("JsonSchemaGenerator.generate");
    expect(() => StandardSchema.of(undefined as never)).toThrow("StandardSchema.of");
  });
});

describe("JsonSchemaGenerator and StandardSchema.of over a model", () => {
  test("the model and its schema give the same validator", () => {
    const Items = t.connection.model(Validated);
    const fromModel = JsonSchemaGenerator.validator(Items);
    expect(fromModel.validator.$jsonSchema).toEqual(JsonSchemaGenerator.generate(Items));
    expect(JsonSchemaGenerator.validator(Items.schema)).toEqual(fromModel);
    expect(JsonSchemaGenerator.generate(Items.schema)).toEqual(JsonSchemaGenerator.generate(Items));
  });

  test("StandardSchema.of validates like the model's own ~standard", async () => {
    const Items = t.connection.model(Validated);
    const standard = StandardSchema.of(Items);
    const own = await Items["~standard"].validate({ nonsense: 1 });
    const viaHelper = await standard["~standard"].validate({ nonsense: 1 });
    expect(viaHelper.issues?.map((issue) => issue.message)).toEqual(own.issues?.map((issue) => issue.message));
    expect(viaHelper.issues?.length).toBeGreaterThan(0);
    expect((await StandardSchema.of(Items.schema)["~standard"].validate({ nonsense: 1 })).issues).toBeDefined();
  });
});

describe("SyncAll.collections", () => {
  test("lists the public SchemaInfo of every collection", () => {
    t.connection.model(CappedLog);
    t.connection.model(Validated);
    const schemas: readonly SchemaInfo[] = SyncAll.collections(t.connection);
    expect(schemas.map((schema) => schema.collection).sort()).toEqual(
      expect.arrayContaining(["s9_logs", t.connection.model(Validated).collectionName]),
    );
    expect(schemas.every((schema) => typeof schema.describe === "function")).toBe(true);
  });
});
