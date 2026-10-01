import type { Db, Document } from "mongodb";
import { ErrorTranslator } from "../errors/error-translator.ts";
import { ModelIndexes } from "../model/model-indexes.ts";
import { type SchemaSource, SchemaSources } from "../schema/compiler/schema-source.ts";
import { JsonSchemaGenerator } from "../schema/json-schema/json-schema-generator.ts";
import { type CollectionDifference, CollectionOptionsError } from "./collection-errors.ts";

/*
 * The collection of a model: its options come from the schema (`@Schema({ capped, timeseries, clustered,
 * validator, collation, changeStreamPreAndPostImages })`) and are compared with what the server stores
 * (`listCollections`). Which options `collMod` can change was checked against MongoDB 8.3.11 and 9.0.0-rc0:
 * - `collMod` changes `validator`/`validationLevel`/`validationAction`, `cappedSize`/`cappedMax`,
 *   `expireAfterSeconds` (time series, clustered), `changeStreamPreAndPostImages`, and the time series
 *   `granularity`/`bucketMaxSpanSeconds`/`bucketRoundingSeconds`;
 * - it cannot change `capped` itself, `collation`, `clusteredIndex`, the time/meta fields, or the kind
 *   (collection, time series, view): the collection has to be dropped.
 * The schema is the complete description (like `syncIndexes`, which drops undeclared indexes): a
 * validator or pre/post images the schema does not declare are a difference too.
 * "Already exists" is explicit (Mongoose's `createCollection` swallowed code 48 and ignored an existing
 * collection with other options): `create` answers `false` only for a collection that matches.
 */

/**
 * What `ensureCollection` did (or, with `dryRun`, would do).
 *
 * @example
 * ```ts
 * const result: EnsureCollectionResult = "created";
 * ```
 */
export type EnsureCollectionResult = "created" | "unchanged" | "updated";

/**
 * Options of `ensureCollection`.
 *
 * @example
 * ```ts
 * const options: EnsureCollectionOptions = { update: true, dryRun: true };
 * ```
 */
export interface EnsureCollectionOptions {
  /**
   * Change the options `collMod` can change when they differ. Without it any difference is a
   * `CollectionOptionsError`: a deployed collection's options should not change by accident.
   */
  readonly update?: boolean;
  /** Only report (`result` and `differences`); nothing is written. A difference `collMod` cannot make still throws. */
  readonly dryRun?: boolean;
}

/**
 * The outcome of `ensureCollection`.
 *
 * @example
 * ```ts
 * const report: EnsureCollectionReport = await Users.ensureCollection({ dryRun: true });
 * if (report.result === "updated") console.log(report.differences.map((d) => d.option));
 * ```
 */
export interface EnsureCollectionReport {
  /** What was (or would be) done. */
  readonly result: EnsureCollectionResult;
  /** The differences found (empty for `"created"` and `"unchanged"`). */
  readonly differences: readonly CollectionDifference[];
}

/**
 * A frozen plain object of collection options.
 *
 * @example
 * ```ts
 * const wanted: Plain = { capped: true, size: 1024 };
 * ```
 */
type Plain = Readonly<Record<string, unknown>>;

/**
 * How the server keeps a collection (one `listCollections` entry).
 *
 * @example
 * ```ts
 * const info: CollectionInfo = { name: "logs", type: "collection", options: { capped: true } };
 * ```
 */
export interface CollectionInfo {
  /** The collection name. */
  readonly name: string;
  /** `collection`, `view` or `timeseries`. */
  readonly type?: string;
  /** The stored creation options. */
  readonly options?: Plain;
}

/** The time series keys `collMod` can change. */
const MUTABLE_TIMESERIES: ReadonlySet<string> = new Set([
  "granularity",
  "bucketMaxSpanSeconds",
  "bucketRoundingSeconds",
]);

/**
 * Serializes a value with object keys sorted, so equal options compare equal regardless of key order.
 *
 * @param value - Any JSON-serializable value.
 * @returns The canonical JSON string.
 */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Object && !Array.isArray(item) && Object.getPrototypeOf(item) === Object.prototype
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

/**
 * A number as the server reports it: `listCollections` returns some options as int64 (`expireAfterSeconds`),
 * which a client with `useBigInt64` reads as `bigint` — `3600n` is the same setting as `3600`.
 *
 * @param value - A stored option value.
 * @returns A `number` for a `bigint`, otherwise the value unchanged.
 */
const numeric = (value: unknown): unknown => (typeof value === "bigint" ? Number(value) : value);

/** What an option the server does not list means (`validationLevel`/`validationAction` defaults). */
const STORED_DEFAULTS: Readonly<Record<string, unknown>> = { validationLevel: "strict", validationAction: "error" };

/** The collection options of schemas and their comparison with the server. */
export class CollectionManager {
  /**
   * The `create` options a schema declares (database names; a discriminator uses its root's). Frozen,
   * plain: what `createCollection` sends.
   *
   * @param source - The model, or its `schema` (the root schema is used).
   * @returns The `createCollection` options.
   * @throws {ConfigurationError} When `source` is neither a model nor the schema of one.
   */
  static optionsOf(source: SchemaSource): Plain {
    const root = SchemaSources.resolve(source, "CollectionManager.optionsOf").root;
    const options = root.options;
    const out: Record<string, unknown> = {};
    if (options.capped !== undefined) {
      out.capped = true;
      out.size = options.capped.size;
      if (options.capped.max !== undefined) out.max = options.capped.max;
    }
    const series = options.timeseries;
    if (series !== undefined) {
      const timeseries: Record<string, unknown> = { timeField: root.toDbPath(series.timeField) ?? series.timeField };
      if (series.metaField !== undefined) timeseries.metaField = root.toDbPath(series.metaField) ?? series.metaField;
      if (series.granularity !== undefined) timeseries.granularity = series.granularity;
      if (series.bucketMaxSpanSeconds !== undefined) timeseries.bucketMaxSpanSeconds = series.bucketMaxSpanSeconds;
      if (series.bucketRoundingSeconds !== undefined) timeseries.bucketRoundingSeconds = series.bucketRoundingSeconds;
      out.timeseries = Object.freeze(timeseries);
      /* The server keeps the TTL of a time series at the top level of the options. */
      if (series.expireAfterSeconds !== undefined) out.expireAfterSeconds = series.expireAfterSeconds;
    }
    const clustered = options.clustered;
    if (clustered !== undefined) {
      const name = clustered === true ? undefined : clustered.name;
      out.clusteredIndex = Object.freeze({ key: { _id: 1 }, unique: true, ...(name === undefined ? {} : { name }) });
      if (clustered !== true && clustered.expireAfterSeconds !== undefined)
        out.expireAfterSeconds = clustered.expireAfterSeconds;
    }
    if (options.validator !== undefined) {
      const validator = JsonSchemaGenerator.validator(root);
      out.validator = validator.validator;
      out.validationLevel = validator.validationLevel;
      out.validationAction = validator.validationAction;
    }
    if (options.collation !== undefined) out.collation = Object.freeze({ ...options.collation });
    if (options.changeStreamPreAndPostImages === true)
      out.changeStreamPreAndPostImages = Object.freeze({ enabled: true });
    return Object.freeze(out);
  }

  /**
   * How the collection is stored now (`undefined`: it does not exist).
   *
   * @param db - The database.
   * @param name - The collection name.
   * @returns The `listCollections` entry, or `undefined`.
   * @throws {TypemoError} The classified driver error when `listCollections` fails.
   */
  static async info(db: Db, name: string): Promise<CollectionInfo | undefined> {
    try {
      return (await db.listCollections({ name }).toArray())[0] as CollectionInfo | undefined;
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
  }

  /**
   * The differences between the declared options and the stored ones. The kind (view, time series,
   * regular) is checked first: a different kind is a `CollectionOptionsError` right away.
   *
   * @param name - The collection name, for messages.
   * @param wanted - The options the schema declares (`optionsOf`).
   * @param info - The stored collection.
   * @returns The differing options; empty when the collection matches.
   * @throws {CollectionOptionsError} When the stored kind (view, time series, regular) differs from the schema's.
   */
  static differences(name: string, wanted: Plain, info: CollectionInfo): CollectionDifference[] {
    if (info.type === "view")
      throw new CollectionOptionsError(name, "exists as a view, not a collection: drop it or use another name");
    if (wanted.timeseries !== undefined && info.type !== "timeseries")
      throw new CollectionOptionsError(
        name,
        "exists as a regular collection; MongoDB cannot turn it into a time series collection: drop it (or use another name)",
      );
    if (wanted.timeseries === undefined && info.type === "timeseries")
      throw new CollectionOptionsError(
        name,
        "is a time series collection on the server and the schema does not declare timeseries: drop it or declare it",
      );
    const stored = info.options ?? {};
    const out: CollectionDifference[] = [];
    const differ = (option: string, mutable: boolean, want: unknown, actual: unknown): void => {
      out.push(Object.freeze({ option, mutable, wanted: want, actual }));
    };
    /* capped: the flag cannot change; its size and max can (on a capped collection). */
    const cappedWanted = wanted.capped === true;
    const cappedActual = stored.capped === true;
    if (cappedWanted !== cappedActual) differ("capped", false, cappedWanted || undefined, cappedActual || undefined);
    else if (cappedWanted) {
      if (numeric(wanted.size) !== numeric(stored.size)) differ("size", true, wanted.size, stored.size);
      if (numeric(wanted.max) !== numeric(stored.max)) differ("max", true, wanted.max, stored.max);
    }
    /* time series: the fields cannot change, the bucketing can. */
    const seriesWanted = wanted.timeseries as Plain | undefined;
    const seriesActual = stored.timeseries as Plain | undefined;
    if (seriesWanted !== undefined && seriesActual !== undefined) {
      const granularity =
        seriesWanted.granularity ?? (seriesWanted.bucketMaxSpanSeconds === undefined ? "seconds" : undefined);
      const compared: Plain = { ...seriesWanted, ...(granularity === undefined ? {} : { granularity }) };
      for (const [key, value] of Object.entries(compared)) {
        if (numeric(seriesActual[key]) !== numeric(value))
          differ(`timeseries.${key}`, MUTABLE_TIMESERIES.has(key), value, seriesActual[key]);
      }
      if (seriesWanted.metaField === undefined && seriesActual.metaField !== undefined)
        differ("timeseries.metaField", false, undefined, seriesActual.metaField);
    }
    if (numeric(wanted.expireAfterSeconds) !== numeric(stored.expireAfterSeconds))
      differ("expireAfterSeconds", true, wanted.expireAfterSeconds, stored.expireAfterSeconds);
    /* clustered: presence and (a declared) name. */
    const clusteredWanted = wanted.clusteredIndex as Plain | undefined;
    const clusteredActual = stored.clusteredIndex as Plain | undefined;
    if (
      (clusteredWanted === undefined) !== (clusteredActual === undefined) ||
      (clusteredWanted?.name !== undefined && clusteredWanted.name !== clusteredActual?.name)
    )
      differ("clusteredIndex", false, clusteredWanted, clusteredActual);
    /* validator (level and action only matter with a validator). */
    if (canonical(wanted.validator) !== canonical(stored.validator))
      differ("validator", true, wanted.validator, stored.validator);
    if (wanted.validator !== undefined) {
      for (const option of ["validationLevel", "validationAction"] as const) {
        const actual = stored[option] ?? STORED_DEFAULTS[option];
        if (wanted[option] !== actual) differ(option, true, wanted[option], stored[option]);
      }
    }
    if (!ModelIndexes.sameCollation(wanted.collation as Plain | undefined, stored.collation as Plain | undefined))
      differ("collation", false, wanted.collation, stored.collation);
    const imagesWanted = (wanted.changeStreamPreAndPostImages as Plain | undefined)?.enabled === true;
    const imagesActual = (stored.changeStreamPreAndPostImages as Plain | undefined)?.enabled === true;
    if (imagesWanted !== imagesActual)
      differ("changeStreamPreAndPostImages", true, { enabled: imagesWanted }, { enabled: imagesActual });
    return out;
  }

  /**
   * The `collMod` command that makes the mutable differences (every difference must be mutable).
   *
   * @param name - The collection name.
   * @param wanted - The options the schema declares.
   * @param differences - The differences to apply.
   * @returns The command document for `db.command`.
   */
  static collMod(name: string, wanted: Plain, differences: readonly CollectionDifference[]): Document {
    const command: Record<string, unknown> = { collMod: name };
    const timeseries: Record<string, unknown> = {};
    for (const { option } of differences) {
      if (option.startsWith("timeseries.")) {
        const key = option.slice("timeseries.".length);
        timeseries[key] = (wanted.timeseries as Plain)[key];
        continue;
      }
      switch (option) {
        case "size":
          command.cappedSize = wanted.size;
          break;
        case "max":
          /* `cappedMax: 0` removes the limit (the server's rule for collMod). */
          command.cappedMax = wanted.max ?? 0;
          break;
        case "expireAfterSeconds":
          command.expireAfterSeconds = wanted.expireAfterSeconds ?? "off";
          break;
        case "validator":
          command.validator = wanted.validator ?? {};
          break;
        case "changeStreamPreAndPostImages":
          command.changeStreamPreAndPostImages = { enabled: wanted.changeStreamPreAndPostImages !== undefined };
          break;
        default:
          command[option] = wanted[option];
      }
    }
    if (Object.keys(timeseries).length > 0) command.timeseries = timeseries;
    return command;
  }

  /**
   * The error for a collection that exists with other options than the schema declares. One text for
   * `createCollection()`, `ensureCollection()`, `init()` and `syncAll()`: options MongoDB cannot change are named
   * first (the way out is to drop the collection); otherwise `collMod` can change them.
   *
   * @param name - The collection name.
   * @param differences - The differing options; not empty.
   * @returns The error to throw.
   */
  private static refusal(name: string, differences: readonly CollectionDifference[]): CollectionOptionsError {
    const immutable = differences.filter((difference) => !difference.mutable);
    if (immutable.length > 0) {
      return new CollectionOptionsError(
        name,
        `exists with options MongoDB cannot change (${immutable.map((difference) => difference.option).join(", ")}): ` +
          "drop the collection and create it again",
        differences,
      );
    }
    return new CollectionOptionsError(
      name,
      `exists with other options (${differences.map((difference) => difference.option).join(", ")}); ` +
        "run ensureCollection({ update: true }) to change them with collMod",
      differences,
    );
  }

  /**
   * Creates the collection with the schema's options. `true`: created; `false`: it already exists WITH
   * these options. Existing with other options (or as a view) is a `CollectionOptionsError` — use
   * `ensureCollection({ update: true })` for what `collMod` can change.
   *
   * @param db - The database.
   * @param source - The model, or its `schema`.
   * @returns `true` when the collection was created, `false` when it already matched.
   * @throws {CollectionOptionsError} When it exists with other options, as a view, or was dropped meanwhile.
   * @throws {ConfigurationError} When `source` is neither a model nor the schema of one.
   */
  static async create(db: Db, source: SchemaSource): Promise<boolean> {
    const schema = SchemaSources.resolve(source, "CollectionManager.create");
    const name = schema.root.collection;
    const wanted = CollectionManager.optionsOf(schema);
    const existing = await CollectionManager.info(db, name);
    if (existing === undefined) {
      try {
        await db.createCollection(name, { ...wanted });
        return true;
      } catch (error) {
        /* Created by someone else between the check and the create: compare what is there now. */
        if (ErrorTranslator.codeOf(error) !== 48) throw ErrorTranslator.wrap(error);
      }
    }
    const info = existing ?? (await CollectionManager.info(db, name));
    if (info === undefined) throw new CollectionOptionsError(name, "was dropped while it was being created");
    const differences = CollectionManager.differences(name, wanted, info);
    if (differences.length > 0) throw CollectionManager.refusal(name, differences);
    return false;
  }

  /**
   * Makes the collection exist with the schema's options: created when missing, `"unchanged"` when it
   * matches, `"updated"` by `collMod` with `update: true`. A difference `collMod` cannot make is always a
   * `CollectionOptionsError` (drop the collection and run it again).
   *
   * @param db - The database.
   * @param source - The model, or its `schema`.
   * @param options - `update` applies `collMod`; `dryRun` only reports.
   * @returns What was (or, with `dryRun`, would be) done, with the differences found.
   * @throws {CollectionOptionsError} On a difference `collMod` cannot make, or any difference without `update`.
   * @throws {ConfigurationError} When `source` is neither a model nor the schema of one.
   */
  static async ensure(
    db: Db,
    source: SchemaSource,
    options: EnsureCollectionOptions = {},
  ): Promise<EnsureCollectionReport> {
    const schema = SchemaSources.resolve(source, "CollectionManager.ensure");
    const name = schema.root.collection;
    const wanted = CollectionManager.optionsOf(schema);
    const info = await CollectionManager.info(db, name);
    if (info === undefined) {
      if (options.dryRun === true) return Object.freeze({ result: "created", differences: Object.freeze([]) });
      const created = await CollectionManager.create(db, schema);
      return Object.freeze({ result: created ? "created" : "unchanged", differences: Object.freeze([]) });
    }
    const differences = Object.freeze(CollectionManager.differences(name, wanted, info));
    if (differences.length === 0) return Object.freeze({ result: "unchanged", differences });
    if (differences.some((difference) => !difference.mutable)) throw CollectionManager.refusal(name, differences);
    if (options.dryRun === true) return Object.freeze({ result: "updated", differences });
    if (options.update !== true) throw CollectionManager.refusal(name, differences);
    try {
      await db.command(CollectionManager.collMod(name, wanted, differences));
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
    return Object.freeze({ result: "updated", differences });
  }
}
