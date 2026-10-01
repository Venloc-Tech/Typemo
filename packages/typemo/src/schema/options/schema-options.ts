import type { CollationOptions, ReadConcernLevel, WriteConcernSettings } from "mongodb";
import type { SchemaExtensions } from "../extensions/extension-registry.ts";

/*
 * Options of `@Schema`. Field names inside the options are checked against the class by the
 * decorator. What is deliberately absent:
 * - `strict`: always "throw", there are no relaxations;
 * - `timestamps` / `versionKey`: service fields come from base classes (`Timestamped`, `Versioned`),
 *   one way to declare them, visible to the type;
 * - `_id`: a document has `_id` exactly when the class declares it (`extends Entity`);
 * - `pluralization`: the naming function is a compile context option.
 */

/**
 * Time series collection options (fields are checked against the class).
 *
 * @example
 * ```ts
 * const options: TimeSeriesSchemaOptions = { timeField: "at", metaField: "sensor", granularity: "minutes" };
 * ```
 */
export interface TimeSeriesSchemaOptions {
  /** A `Date` field of the class. */
  readonly timeField: string;
  /** A field of the class (not `_id`, not the time field). */
  readonly metaField?: string;
  /** Bucketing granularity hint for the server. */
  readonly granularity?: "seconds" | "minutes" | "hours";
  /** Maximum time span of one bucket, in seconds (with `bucketRoundingSeconds`, instead of `granularity`). */
  readonly bucketMaxSpanSeconds?: number;
  /** Rounding of the bucket start time, in seconds. */
  readonly bucketRoundingSeconds?: number;
  /** Automatic removal of old measurements. */
  readonly expireAfterSeconds?: number;
}

/**
 * Capped collection options.
 *
 * @example
 * ```ts
 * const options: CappedSchemaOptions = { size: 1_048_576, max: 1000 };
 * ```
 */
export interface CappedSchemaOptions {
  /** Maximum size in bytes. */
  readonly size: number;
  /** Maximum number of documents. */
  readonly max?: number;
}

/**
 * A clustered collection: the documents are stored in `_id` order (the clustered index `{ _id: 1 }`,
 * unique). Not with `capped` or `timeseries` (a time series is clustered by itself).
 *
 * @example
 * ```ts
 * const options: ClusteredSchemaOptions = { name: "by_id", expireAfterSeconds: 3600 };
 * ```
 */
export interface ClusteredSchemaOptions {
  /** The name of the clustered index (the server default otherwise). */
  readonly name?: string;
  /** TTL of the collection: documents whose `_id` (a `Date`) is older are removed. Needs a `Date` `_id`. */
  readonly expireAfterSeconds?: number;
}

/**
 * Server-side `$jsonSchema` validator generated from the schema.
 *
 * @example
 * ```ts
 * const options: ValidatorSchemaOptions = { validationLevel: "moderate", validationAction: "warn" };
 * ```
 */
export interface ValidatorSchemaOptions {
  /** Which documents the server validates: all inserts and updates, only valid ones, or none. */
  readonly validationLevel?: "strict" | "moderate" | "off";
  /** Whether a violation is rejected or only logged. */
  readonly validationAction?: "error" | "warn";
}

/**
 * Multi-tenancy policy: the model records and checks the tenant field, and the policy filters by it.
 *
 * @example
 * ```ts
 * const options: TenantSchemaOptions = { field: "orgId" };
 * ```
 */
export interface TenantSchemaOptions {
  /** The tenant field of the class (default `tenantId`). */
  readonly field?: string;
}

/**
 * Soft delete policy: the model records and checks the deletion marker field.
 *
 * @example
 * ```ts
 * const options: SoftDeleteSchemaOptions = { field: "removedAt" };
 * ```
 */
export interface SoftDeleteSchemaOptions {
  /** A `Date | null` field of the class (default `deletedAt`). */
  readonly field?: string;
}

/**
 * Audit policy: every write of the model leaves an entry. Secret fields are masked in the entry by the
 * field option `sensitive`.
 * A write called outside a transaction runs in its own transaction (the write and its entry commit
 * together), so **a replica set or a sharded cluster is required**; on a standalone mongod such a
 * write is a `ConfigurationError`.
 *
 * @example
 * ```ts
 * const options: AuditSchemaOptions = { collection: "users_history" };
 * ```
 */
export interface AuditSchemaOptions {
  /** The audit collection (default `<collection>_audit`). */
  readonly collection?: string;
}

/**
 * Everything `@Schema({...})` accepts.
 *
 * @example
 * ```ts
 * const options: SchemaOptions = { collection: "users", softDelete: true, autoIndex: false };
 * ```
 */
export interface SchemaOptions {
  /** Collection name. Default: the naming function of the compile context (lowercase + English plural). */
  readonly collection?: string;
  /**
   * A nested object: a group of fields of its parent, without `_id` and without its own hooks.
   * Without it a class used as a field type is a subdocument.
   */
  readonly nested?: true;
  /** Options of registered extensions, by extension name: metadata for integrations (checked, frozen). */
  readonly ext?: SchemaExtensions;
  /** The field holding the discriminator value (default `__t`, added as a service field). A declared string field. */
  readonly discriminatorKey?: string;
  /**
   * The discriminator classes of this base: every class of its hierarchy below it (children and their own
   * discriminators), as a thunk, because they are declared after the base. The schema build compares the list
   * with the classes registered by `@Discriminator`: a class missing from the list, or a listed class that is not
   * a discriminator of this base, is a `ConfigurationError`.
   */
  readonly discriminators?: () => readonly (abstract new () => object)[];
  /** Makes the collection a time series collection. */
  readonly timeseries?: TimeSeriesSchemaOptions;
  /** Makes the collection a capped collection. */
  readonly capped?: CappedSchemaOptions;
  /** Default collation of the collection. */
  readonly collation?: CollationOptions;
  /** A clustered collection (`true`: the default index name, no TTL). */
  readonly clustered?: true | ClusteredSchemaOptions;
  /**
   * Record pre- and post-images of changes (`changeStreamPreAndPostImages`), needed by change streams with
   * `fullDocumentBeforeChange` and by `fullDocument: "required" | "whenAvailable"`.
   */
  readonly changeStreamPreAndPostImages?: true;
  /** Generate a `$jsonSchema` collection validator (`true` = level `strict`, action `error`). */
  readonly validator?: true | ValidatorSchemaOptions;
  /**
   * Whether `connection.init()` and `connection.syncAll()` build the declared indexes of this collection
   * (`false` leaves them out). Nothing is built on its own when the model is created. Default `true`.
   */
  readonly autoIndex?: boolean;
  /**
   * Whether `connection.init()` and `connection.syncAll()` create this collection (`false` leaves it out, and
   * `Model.createCollection()` then throws `ConfigurationError`). Nothing is created on its own when the model
   * is created. Default `true`.
   */
  readonly autoCreate?: boolean;
  /** Default read concern of the collection. */
  readonly readConcern?: { readonly level: ReadConcernLevel };
  /** Default write concern of the collection. */
  readonly writeConcern?: WriteConcernSettings;
  /**
   * Optimistic concurrency. Needs `Versioned`.
   * - `true`: every `save()` that changes the document is conditional on the version it was read with, and
   *   increments it;
   * - a list of paths (`["balance", "profile.email", "comments.text", "settings.$*"]`, checked against the class):
   *   only a save that changes one of them (or writes a whole array/subdocument containing one) is conditional and
   *   increments the version; any other save keeps the default protection below (Mongoose dropped it).
   * Without it the version protects positional array changes only (Mongoose's default).
   */
  readonly optimisticConcurrency?: true | readonly [string, ...string[]];
  /**
   * The shard key of the collection: `save()`/`bulkSave()` filter by the ORIGINAL values of these
   * fields (as read), so a document whose shard key field changed is still found.
   */
  readonly shardKey?: Readonly<Record<string, 1 | "hashed">>;
  /** The multi-tenancy policy (`true`: the default field). */
  readonly tenant?: true | TenantSchemaOptions;
  /** The soft delete policy (`true`: the default field). */
  readonly softDelete?: true | SoftDeleteSchemaOptions;
  /**
   * The audit policy (see {@link AuditSchemaOptions}; needs a replica set). An entry records the operation as
   * called: a write by a filter without `_id` (`updateMany({ status: "open" }, …)`) logs that filter and the counts,
   * not the ids of the documents it touched. For the history of one document, write by its `_id` (`updateOne({ _id }, …)`,
   * `$save`), or read the ids first inside a transaction and write with `{ _id: { $in: ids } }`.
   */
  readonly audit?: true | AuditSchemaOptions;
}

/*
 * Every key of `SchemaOptions`, in the one place that knows them: the schema compiler rejects any other key of
 * `@Schema({...})`. The mapped type makes the compiler fail here when an option is added to or removed from
 * `SchemaOptions` and this list is not updated.
 */
const SCHEMA_OPTION_FLAGS: { readonly [K in keyof SchemaOptions]-?: true } = {
  collection: true,
  nested: true,
  ext: true,
  discriminatorKey: true,
  discriminators: true,
  timeseries: true,
  capped: true,
  collation: true,
  clustered: true,
  changeStreamPreAndPostImages: true,
  validator: true,
  autoIndex: true,
  autoCreate: true,
  readConcern: true,
  writeConcern: true,
  optimisticConcurrency: true,
  shardKey: true,
  tenant: true,
  softDelete: true,
  audit: true,
};

/** The keys `@Schema` accepts. */
export const SCHEMA_OPTION_KEYS: readonly string[] = Object.freeze(Object.keys(SCHEMA_OPTION_FLAGS));
