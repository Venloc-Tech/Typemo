/*
 * The schema-level helpers take a model or its `schema`, and return public types. The compiled internals are
 * not accepted by name in a signature and not returned.
 */
import { expectTypeOf } from "expect-type";
import {
  type BsonJsonSchema,
  type CollectionInfo,
  CollectionManager,
  type CollectionValidator,
  type Connection,
  type EnsureCollectionReport,
  JsonSchemaGenerator,
  type Model,
  type SchemaInfo,
  type SchemaSource,
  StandardSchema,
  type StandardSchemaV1,
  SyncAll,
} from "../../../src/index.ts";
import { Account } from "../../fixtures/steps/step-entities.ts";

declare const Accounts: Model<Account>;
declare const connection: Connection;
declare const db: import("mongodb").Db;

/* A model and its schema both go in. */
expectTypeOf(Accounts).toExtend<SchemaSource>();
expectTypeOf(Accounts.schema).toExtend<SchemaSource>();

expectTypeOf(JsonSchemaGenerator.generate(Accounts)).toEqualTypeOf<BsonJsonSchema>();
expectTypeOf(JsonSchemaGenerator.validator(Accounts.schema)).toEqualTypeOf<CollectionValidator>();
expectTypeOf(StandardSchema.of(Accounts)).toExtend<StandardSchemaV1>();
expectTypeOf(CollectionManager.optionsOf(Accounts)).toEqualTypeOf<Readonly<Record<string, unknown>>>();
expectTypeOf(CollectionManager.create(db, Accounts)).toEqualTypeOf<Promise<boolean>>();
expectTypeOf(CollectionManager.ensure(db, Accounts.schema)).toEqualTypeOf<Promise<EnsureCollectionReport>>();
expectTypeOf(CollectionManager.info(db, "accounts")).toEqualTypeOf<Promise<CollectionInfo | undefined>>();

/* What comes back is public. */
expectTypeOf(SyncAll.collections(connection)).toEqualTypeOf<readonly SchemaInfo[]>();

// @ts-expect-error a plain string is neither a model nor a schema
JsonSchemaGenerator.generate("accounts");
// @ts-expect-error an entity class is not a schema source (it has no connection to compile with)
CollectionManager.optionsOf(Account);
