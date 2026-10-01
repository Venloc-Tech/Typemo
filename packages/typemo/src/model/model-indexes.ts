import type { CollationOptions, Collection, Db, Document, IndexDescriptionInfo } from "mongodb";
import { ErrorTranslator } from "../errors/error-translator.ts";
import { type IndexFailure, IndexSyncError } from "../errors/index-sync-error.ts";
import { TypemoError } from "../errors/typemo-error.ts";
import { DriverExecutor } from "../operation/executor/driver-executor.ts";
import type { CompiledIndex, CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import { IndexHelpers } from "../schema/indexes/index-helpers.ts";
import type { SearchIndexOptions } from "../schema/options/index-options.ts";

/*
 * Index management of a model: the schema's indexes against the server's.
 * Every failure is collected (Mongoose stopped at the first) and reported together as
 * `IndexSyncError`; the indexes that succeeded stay applied.
 *
 * The comparison is exact and symmetric:
 * - collation: both sides are compared as the server stores them — an index without a collation takes
 *   the COLLECTION's default collation (read from the server), so the wanted side gets it too; the
 *   server expands a collation to every field, so fields the schema leaves out are compared with the ICU
 *   defaults (Mongoose's `diffIndexes` applied the schema collation on one side only and recreated such
 *   indexes forever);
 * - `unique`/`sparse`/`hidden: false` equal an absent option (the server keeps `sparse: false`; Mongoose
 *   compared `unique: false` with an absent option as different);
 * - `hidden` and a changed TTL (`expireAfterSeconds`) are changed in place with `collMod` (no rebuild);
 * - the clustered index of a clustered collection is the collection's, never dropped or compared.
 * Search indexes (Atlas Search / Vector Search) have their own diff and sync (a plain mongod answers
 * `SearchNotEnabled`, code 31082: the error is reported, never swallowed).
 */

/**
 * A change `collMod` applies to an existing index without rebuilding it.
 *
 * @example
 * ```ts
 * const change: IndexModification = { name: "createdAt_1", expireAfterSeconds: 3600 };
 * ```
 */
export interface IndexModification {
  /** The index name. */
  readonly name: string;
  /** Hide or unhide the index. */
  readonly hidden?: boolean;
  /** The new TTL of a TTL index. */
  readonly expireAfterSeconds?: number;
}

/**
 * What `diffIndexes` found.
 *
 * @example
 * ```ts
 * const diff: IndexDiff = await Users.diffIndexes();
 * console.log(diff.toCreate, diff.toDrop, diff.toModify);
 * ```
 */
export interface IndexDiff {
  /** Names of schema indexes the server lacks (or has with other keys/options). */
  readonly toCreate: readonly string[];
  /** Names of server indexes the schema does not declare (or declares differently). `_id_` never. */
  readonly toDrop: readonly string[];
  /** Indexes changed in place by `collMod` (`hidden`, TTL). */
  readonly toModify: readonly IndexModification[];
}

/**
 * The outcome of `syncIndexes`.
 *
 * @example
 * ```ts
 * const result: IndexSyncResult = await Users.syncIndexes({ dryRun: true });
 * if (result.dryRun) console.log("would create", result.toCreate);
 * ```
 */
export interface IndexSyncResult extends IndexDiff {
  /** `true` when nothing was changed on the server (`dryRun`). */
  readonly dryRun: boolean;
}

/**
 * What `diffSearchIndexes` found (Atlas Search / Vector Search indexes, by name).
 *
 * @example
 * ```ts
 * const diff: SearchIndexDiff = await Users.diffSearchIndexes();
 * console.log(diff.toCreate, diff.toUpdate, diff.toDrop);
 * ```
 */
export interface SearchIndexDiff {
  /** Names of schema search indexes the server lacks. */
  readonly toCreate: readonly string[];
  /** Existing search indexes whose definition (or type) differs: `updateSearchIndex`. */
  readonly toUpdate: readonly string[];
  /** Names of server search indexes the schema does not declare. */
  readonly toDrop: readonly string[];
}

/**
 * The outcome of `syncSearchIndexes`.
 *
 * @example
 * ```ts
 * const result: SearchIndexSyncResult = await Users.syncSearchIndexes();
 * console.log(result.dryRun, result.toCreate);
 * ```
 */
export interface SearchIndexSyncResult extends SearchIndexDiff {
  /** `true` when nothing was changed on the server (`dryRun`). */
  readonly dryRun: boolean;
}

/** Options compared exactly (after the defaults below); `hidden`, `expireAfterSeconds`, `collation` apart. */
const COMPARED = [
  "unique",
  "sparse",
  "partialFilterExpression",
  "weights",
  "default_language",
  "language_override",
  "wildcardProjection",
] as const;

/** What an absent option means on the server: an option equal to its default is the same as absent. */
const OPTION_DEFAULTS: Readonly<Record<string, unknown>> = {
  unique: false,
  sparse: false,
  hidden: false,
};

/** Text index defaults the server writes into `listIndexes`. */
const TEXT_DEFAULTS: Readonly<Record<string, unknown>> = {
  default_language: "english",
  language_override: "language",
};

/**
 * ICU defaults of the collation fields the server fills in (checked on 8.3.11 and 9.0.0-rc0). `caseFirst`
 * and `backwards` depend on the locale (`fr_CA` has `backwards: true`): compared only when the schema
 * sets them. `version` is the ICU version, never compared.
 */
const COLLATION_DEFAULTS: Readonly<Record<string, unknown>> = {
  caseLevel: false,
  strength: 3,
  numericOrdering: false,
  alternate: "non-ignorable",
  maxVariable: "punct",
  normalization: false,
};

/** Collation fields whose default depends on the locale: compared only when the schema sets them. */
const LOCALE_DEPENDENT = ["caseFirst", "backwards"] as const;

/**
 * A frozen plain object as returned by the server.
 *
 * @example
 * ```ts
 * const stored: Plain = { unique: true, sparse: false };
 * ```
 */
type Plain = Readonly<Record<string, unknown>>;

/**
 * Serializes a value with object keys sorted (and `bigint` tagged), so equal options compare equal.
 *
 * @param value - Any JSON-serializable value, `bigint` included.
 * @returns The canonical JSON string.
 */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint"
      ? `${item}n`
      : item instanceof Object && !Array.isArray(item) && Object.getPrototypeOf(item) === Object.prototype
        ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : item,
  );

/** Index operations of a model. */
export class ModelIndexes {
  /**
   * The schema's indexes by name.
   *
   * @param schema - The compiled schema.
   * @returns The declared indexes keyed by index name.
   */
  static desired(schema: CompiledSchema): ReadonlyMap<string, CompiledIndex> {
    return new Map(schema.indexes.map((index) => [IndexHelpers.nameOf(index), index]));
  }

  /**
   * `undefined` for "no collation": absent or the binary `simple` locale (9.0 reports it on every index).
   *
   * @param collation - A collation as declared or as stored.
   * @returns The collation, or `undefined` when it is none or `simple`.
   */
  static effectiveCollation(collation: CollationOptions | Plain | undefined): Plain | undefined {
    return collation === undefined || (collation as Plain).locale === "simple" ? undefined : (collation as Plain);
  }

  /**
   * Two collations are the same as the server applies them. `wanted` is the schema's (an index's own, or
   * the collection default it inherits); `actual` the server's expanded one. Symmetric: both sides go
   * through the same normalization (`simple` = none; an unset field = its ICU default).
   *
   * @param wanted - The schema's collation.
   * @param actual - The server's collation.
   * @returns `true` when the server would treat them the same.
   */
  static sameCollation(
    wanted: CollationOptions | Plain | undefined,
    actual: CollationOptions | Plain | undefined,
  ): boolean {
    const left = ModelIndexes.effectiveCollation(wanted);
    const right = ModelIndexes.effectiveCollation(actual);
    if (left === undefined || right === undefined) return left === right;
    const value = (side: Plain, key: string): unknown => side[key] ?? COLLATION_DEFAULTS[key];
    if (left.locale !== right.locale) return false;
    if (!Object.keys(COLLATION_DEFAULTS).every((key) => value(left, key) === value(right, key))) return false;
    /* A locale-dependent field is compared only when the schema side sets it. */
    return LOCALE_DEPENDENT.every((key) => left[key] === undefined || left[key] === right[key]);
  }

  /**
   * An option's value with its default folded to "absent".
   *
   * @param source - An index description.
   * @param key - The option name.
   * @returns The value, or `undefined` when absent or equal to its default.
   */
  private static option(source: Plain, key: string): unknown {
    const value = source[key];
    if (value === undefined || value === OPTION_DEFAULTS[key]) return undefined;
    return value;
  }

  /**
   * How a server index relates to a schema index: `"same"`, `"modify"` (only `hidden` or the TTL value
   * differ: `collMod`), or `"rebuild"` (drop and create).
   *
   * @param index - The schema's index.
   * @param existing - The server's index of the same name.
   * @param collectionCollation - The collection's default collation on the server (inherited by an index
   * created without one).
   * @returns The verdict, plus the `collMod` change for `"modify"`.
   */
  static compare(
    index: CompiledIndex,
    existing: IndexDescriptionInfo,
    collectionCollation?: Plain,
  ): { readonly verdict: "same" | "modify" | "rebuild"; readonly modification?: IndexModification } {
    const name = IndexHelpers.nameOf(index);
    const text = IndexHelpers.isText(index.keys);
    if (!text && !IndexHelpers.sameKeys(index.keys, existing.key as Record<string, never>))
      return { verdict: "rebuild" };
    /* A text index is stored as `{ _fts: "text", _ftsx: 1, ...other keys }`: its text fields are its weights,
       the other keys (a compound text index, Mongoose gh-13136) are compared as they are. */
    if (text) {
      const others = Object.fromEntries(Object.entries(index.keys).filter(([, direction]) => direction !== "text"));
      const stored = Object.fromEntries(
        Object.entries(existing.key).filter(([path]) => path !== "_fts" && path !== "_ftsx"),
      ) as Record<string, never>;
      if (!IndexHelpers.sameKeys(others as Record<string, never>, stored)) return { verdict: "rebuild" };
    }
    const description = IndexHelpers.toDescription(index) as unknown as Plain;
    const server = existing as unknown as Plain;
    const same = COMPARED.every((option) => {
      if (text && option === "weights") {
        /* Only the text fields have weights: the server stores 1 for every text field without an explicit
           weight, so the declared weights are laid over those defaults; the other keys of a compound text
           index have none. */
        const weights: Plain = {
          ...Object.fromEntries(
            Object.entries(index.keys)
              .filter(([, direction]) => direction === "text")
              .map(([path]) => [path, 1]),
          ),
          ...((description.weights as Plain | undefined) ?? {}),
        };
        return canonical(weights) === canonical(server.weights);
      }
      if (text && option in TEXT_DEFAULTS) {
        return (description[option] ?? TEXT_DEFAULTS[option]) === (server[option] ?? TEXT_DEFAULTS[option]);
      }
      return canonical(ModelIndexes.option(description, option)) === canonical(ModelIndexes.option(server, option));
    });
    if (!same) return { verdict: "rebuild" };
    const wantedCollation = (description.collation as Plain | undefined) ?? collectionCollation;
    if (!ModelIndexes.sameCollation(wantedCollation, server.collation as Plain | undefined))
      return { verdict: "rebuild" };
    /* int64 on the server: a `useBigInt64` client reads `bigint`. */
    const ttl = (value: unknown): number | undefined =>
      typeof value === "bigint" ? Number(value) : (value as number | undefined);
    const wantedTtl = ttl(description.expireAfterSeconds);
    const actualTtl = ttl(server.expireAfterSeconds);
    /* A TTL can be changed in place, not added or removed (the server's collMod would convert, but the
       index then has another meaning: rebuild keeps one rule). */
    if ((wantedTtl === undefined) !== (actualTtl === undefined)) return { verdict: "rebuild" };
    const wantedHidden = ModelIndexes.option(description, "hidden") === true;
    const actualHidden = ModelIndexes.option(server, "hidden") === true;
    const modification: { name: string; hidden?: boolean; expireAfterSeconds?: number } = { name };
    if (wantedHidden !== actualHidden) modification.hidden = wantedHidden;
    if (wantedTtl !== undefined && wantedTtl !== actualTtl) modification.expireAfterSeconds = wantedTtl;
    return Object.keys(modification).length === 1
      ? { verdict: "same" }
      : { verdict: "modify", modification: Object.freeze(modification) };
  }

  /**
   * `true` when a server index matches a schema index exactly (nothing to change).
   *
   * @param index - The schema's index.
   * @param existing - The server's index.
   * @param collectionCollation - The collection's default collation on the server.
   * @returns Whether `compare` answers `"same"`.
   */
  static matches(index: CompiledIndex, existing: IndexDescriptionInfo, collectionCollation?: Plain): boolean {
    return ModelIndexes.compare(index, existing, collectionCollation).verdict === "same";
  }

  /**
   * The options the server keeps for a collection (`{}`: none, or the collection does not exist).
   *
   * @param db - The database.
   * @param name - The collection name.
   * @returns The stored creation options.
   * @throws {TypemoError} The classified driver error when `listCollections` fails.
   */
  static async collectionOptions(db: Db, name: string): Promise<Plain> {
    try {
      const [info] = await db.listCollections({ name }).toArray();
      return (info as { options?: Plain } | undefined)?.options ?? {};
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
  }

  /**
   * An index the server makes itself: `_id_`, the clustered index, and the `{ meta: 1, time: 1 }` index of
   * a time series collection with a meta field (Mongoose H161 tried to drop it).
   *
   * @param index - A server index.
   * @param options - The collection's stored options.
   * @returns `true` when the server owns the index.
   */
  static serverOwned(index: IndexDescriptionInfo, options: Plain): boolean {
    if (index.name === "_id_" || (index as unknown as Plain).clustered === true) return true;
    const series = options.timeseries as Plain | undefined;
    if (series?.metaField === undefined) return false;
    const keys = Object.entries(index.key);
    return (
      index.name === `${String(series.metaField)}_1_${String(series.timeField)}_1` &&
      keys.length === 2 &&
      keys[0]?.[0] === series.metaField &&
      keys[1]?.[0] === series.timeField
    );
  }

  /**
   * Compares the schema's indexes with the server's.
   *
   * @param schema - The compiled schema.
   * @param collection - The collection.
   * @param db - The database; without it the collection's default collation and time series options are unknown.
   * @returns The indexes to create, drop and modify.
   */
  static async diff(schema: CompiledSchema, collection: Collection<Document>, db?: Db): Promise<IndexDiff> {
    const options = db === undefined ? {} : await ModelIndexes.collectionOptions(db, collection.collectionName);
    const collation = options.collation as Plain | undefined;
    const desired = ModelIndexes.desired(schema);
    /* The server's own indexes belong to the collection, not to the schema — unless the schema declares one. */
    const existing = (await DriverExecutor.listIndexes(collection)).filter(
      (index) => !ModelIndexes.serverOwned(index, options) || (index.name !== undefined && desired.has(index.name)),
    );
    const toCreate: string[] = [];
    const toDrop: string[] = [];
    const toModify: IndexModification[] = [];
    for (const [name, index] of desired) {
      const found = existing.find((candidate) => candidate.name === name);
      if (found === undefined) {
        toCreate.push(name);
        continue;
      }
      const { verdict, modification } = ModelIndexes.compare(index, found, collation);
      if (verdict === "rebuild") {
        toDrop.push(name);
        toCreate.push(name);
      } else if (verdict === "modify" && modification !== undefined) toModify.push(modification);
    }
    for (const index of existing) {
      if (index.name !== undefined && !desired.has(index.name)) toDrop.push(index.name);
    }
    return Object.freeze({
      toCreate: Object.freeze(toCreate),
      toDrop: Object.freeze(toDrop),
      toModify: Object.freeze(toModify),
    });
  }

  /**
   * Creates the given schema indexes (all by default), collecting every failure.
   *
   * @param schema - The compiled schema.
   * @param collection - The collection.
   * @param names - The index names to create.
   * @returns The names that were created.
   * @throws {IndexSyncError} When any index could not be created; the others stay created.
   */
  static async create(
    schema: CompiledSchema,
    collection: Collection<Document>,
    names: readonly string[] = [...ModelIndexes.desired(schema).keys()],
  ): Promise<readonly string[]> {
    const desired = ModelIndexes.desired(schema);
    const failures: IndexFailure[] = [];
    const created: string[] = [];
    for (const name of names) {
      const index = desired.get(name);
      if (index === undefined) continue;
      try {
        await DriverExecutor.createIndex(collection, IndexHelpers.toDescription(index));
        created.push(name);
      } catch (error) {
        failures.push({ name, action: "create", error: ModelIndexes.typemo(error) });
      }
    }
    if (failures.length > 0) throw new IndexSyncError(schema.name, failures);
    return Object.freeze(created);
  }

  /**
   * Brings the server's indexes to the schema's; `dryRun` only reports.
   *
   * @param schema - The compiled schema.
   * @param collection - The collection.
   * @param dryRun - Only report; nothing is written.
   * @param db - The database; needed for `collMod` changes (without it they are skipped).
   * @returns The applied (or, with `dryRun`, planned) changes.
   * @throws {IndexSyncError} When any drop, modification or creation failed; the others stay applied.
   */
  static async sync(
    schema: CompiledSchema,
    collection: Collection<Document>,
    dryRun: boolean,
    db?: Db,
  ): Promise<IndexSyncResult> {
    const diff = await ModelIndexes.diff(schema, collection, db);
    if (dryRun) return Object.freeze({ ...diff, dryRun: true });
    const failures: IndexFailure[] = [];
    for (const name of diff.toDrop) {
      try {
        await DriverExecutor.dropIndex(collection, name);
      } catch (error) {
        failures.push({ name, action: "drop", error: ModelIndexes.typemo(error) });
      }
    }
    for (const modification of diff.toModify) {
      if (db === undefined) break;
      try {
        const { name, ...change } = modification;
        await db.command({ collMod: collection.collectionName, index: { name, ...change } });
      } catch (error) {
        failures.push({ name: modification.name, action: "modify", error: ModelIndexes.typemo(error) });
      }
    }
    try {
      await ModelIndexes.create(schema, collection, diff.toCreate);
    } catch (error) {
      if (!(error instanceof IndexSyncError)) throw error;
      failures.push(...error.failures);
    }
    if (failures.length > 0) throw new IndexSyncError(schema.name, failures);
    return Object.freeze({ ...diff, dryRun: false });
  }

  /**
   * Used by `connection.init()`: creates the schema indexes the server LACKS and nothing else — an index the
   * schema does not declare stays (never dropped), one declared differently is a failure (`syncIndexes`/`syncAll`
   * replaces it), a `hidden`/TTL difference is left alone too (reported as a failure). Every failure is collected.
   *
   * @param schema - The compiled schema.
   * @param collection - The collection.
   * @param db - The database.
   * @param dryRun - Only report the missing indexes; nothing is created.
   * @returns The indexes that were (or, with `dryRun`, would be) created.
   * @throws {IndexSyncError} When an index differs on the server or could not be created.
   */
  static async ensure(
    schema: CompiledSchema,
    collection: Collection<Document>,
    db?: Db,
    dryRun = false,
  ): Promise<IndexSyncResult> {
    const diff = await ModelIndexes.diff(schema, collection, db);
    const differing = new Set(diff.toCreate.filter((name) => diff.toDrop.includes(name)));
    const missing = diff.toCreate.filter((name) => !differing.has(name));
    const failures: IndexFailure[] = [...differing, ...diff.toModify.map((modification) => modification.name)].map(
      (name) => ({
        name,
        action: "create" as const,
        error: new TypemoError(
          `${schema.name}: index "${name}" exists on the server with other keys or options; init() never drops or changes an index — run syncIndexes()/syncAll() to replace it`,
        ),
      }),
    );
    if (!dryRun) {
      try {
        await ModelIndexes.create(schema, collection, missing);
      } catch (error) {
        if (!(error instanceof IndexSyncError)) throw error;
        failures.push(...error.failures);
      }
    }
    if (failures.length > 0) throw new IndexSyncError(schema.name, failures);
    return Object.freeze({
      toCreate: Object.freeze(missing),
      toDrop: Object.freeze([]),
      toModify: Object.freeze([]),
      dryRun,
    });
  }

  /**
   * The schema's search indexes by name.
   *
   * @param schema - The compiled schema.
   * @returns The declared search indexes keyed by name.
   */
  static desiredSearch(schema: CompiledSchema): ReadonlyMap<string, SearchIndexOptions> {
    return new Map(schema.searchIndexes.map((index) => [index.name, index]));
  }

  /**
   * The server's search indexes (`$listSearchIndexes`). A server without search (a plain mongod: code
   * 31082 `SearchNotEnabled`) is an error — never "no indexes".
   *
   * @param collection - The collection.
   * @returns The search index descriptions; empty when the collection does not exist.
   * @throws {TypemoError} When the server cannot list search indexes.
   */
  static async listSearch(collection: Collection<Document>): Promise<readonly Plain[]> {
    try {
      return (await collection.listSearchIndexes().toArray()) as Plain[];
    } catch (error) {
      if (ErrorTranslator.codeOf(error) === 26) return [];
      throw ModelIndexes.typemo(error);
    }
  }

  /**
   * Compares the schema's search indexes with the server's (by name; the definition and type must match).
   *
   * @param schema - The compiled schema.
   * @param collection - The collection.
   * @returns The search indexes to create, update and drop.
   * @throws {TypemoError} When the server cannot list search indexes.
   */
  static async diffSearch(schema: CompiledSchema, collection: Collection<Document>): Promise<SearchIndexDiff> {
    const existing = await ModelIndexes.listSearch(collection);
    const desired = ModelIndexes.desiredSearch(schema);
    const toCreate: string[] = [];
    const toUpdate: string[] = [];
    for (const [name, index] of desired) {
      const found = existing.find((candidate) => candidate.name === name);
      if (found === undefined) toCreate.push(name);
      else if (!ModelIndexes.sameSearch(index, found)) toUpdate.push(name);
    }
    const toDrop = existing
      .map((index) => index.name)
      .filter((name): name is string => typeof name === "string" && !desired.has(name));
    return Object.freeze({
      toCreate: Object.freeze(toCreate),
      toUpdate: Object.freeze(toUpdate),
      toDrop: Object.freeze(toDrop),
    });
  }

  /**
   * A server search index against the schema's: the type and the latest definition.
   *
   * @param index - The schema's search index.
   * @param existing - The server's search index.
   * @returns `true` when type and definition match.
   */
  static sameSearch(index: SearchIndexOptions, existing: Plain): boolean {
    return (
      (index.type ?? "search") === (existing.type ?? "search") &&
      canonical(index.definition) === canonical(existing.latestDefinition ?? existing.definition)
    );
  }

  /**
   * Used by `connection.init()`: creates the missing search indexes only (a differing one is a failure, an extra
   * one stays).
   *
   * @param schema - The compiled schema.
   * @param collection - The collection.
   * @param dryRun - Only report the missing search indexes; nothing is created.
   * @returns The outcome; failures are collected.
   * @throws {IndexSyncError} When any index could not be created.
   */
  static async ensureSearch(
    schema: CompiledSchema,
    collection: Collection<Document>,
    dryRun = false,
  ): Promise<SearchIndexSyncResult> {
    const diff = await ModelIndexes.diffSearch(schema, collection);
    const desired = ModelIndexes.desiredSearch(schema);
    const failures: IndexFailure[] = diff.toUpdate.map((name) => ({
      name,
      action: "updateSearch" as const,
      error: new TypemoError(
        `${schema.name}: search index "${name}" differs on the server; init() never changes an index — run syncAll()`,
      ),
    }));
    for (const name of dryRun ? [] : diff.toCreate) {
      const index = desired.get(name);
      if (index === undefined) continue;
      try {
        await collection.createSearchIndex({ name, type: index.type ?? "search", definition: { ...index.definition } });
      } catch (error) {
        failures.push({ name, action: "createSearch", error: ModelIndexes.typemo(error) });
      }
    }
    if (failures.length > 0) throw new IndexSyncError(schema.name, failures);
    return Object.freeze({
      toCreate: diff.toCreate,
      toUpdate: Object.freeze([]),
      toDrop: Object.freeze([]),
      dryRun,
    });
  }

  /**
   * Brings the server's search indexes to the schema's (every failure collected); `dryRun` only reports.
   *
   * @param schema - The compiled schema.
   * @param collection - The collection.
   * @param dryRun - Only report; nothing is written.
   * @returns The applied (or, with `dryRun`, planned) changes.
   * @throws {IndexSyncError} When any drop, update or creation failed; the others stay applied.
   */
  static async syncSearch(
    schema: CompiledSchema,
    collection: Collection<Document>,
    dryRun: boolean,
  ): Promise<SearchIndexSyncResult> {
    const diff = await ModelIndexes.diffSearch(schema, collection);
    if (dryRun) return Object.freeze({ ...diff, dryRun: true });
    const desired = ModelIndexes.desiredSearch(schema);
    const failures: IndexFailure[] = [];
    const attempt = async (name: string, action: IndexFailure["action"], run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        failures.push({ name, action, error: ModelIndexes.typemo(error) });
      }
    };
    for (const name of diff.toDrop) await attempt(name, "dropSearch", () => collection.dropSearchIndex(name));
    for (const name of diff.toUpdate) {
      const index = desired.get(name);
      if (index !== undefined)
        await attempt(name, "updateSearch", () => collection.updateSearchIndex(name, { ...index.definition }));
    }
    for (const name of diff.toCreate) {
      const index = desired.get(name);
      if (index !== undefined)
        await attempt(name, "createSearch", () =>
          collection.createSearchIndex({ name, type: index.type ?? "search", definition: { ...index.definition } }),
        );
    }
    if (failures.length > 0) throw new IndexSyncError(schema.name, failures);
    return Object.freeze({ ...diff, dryRun: false });
  }

  /**
   * Turns any thrown value into a `TypemoError`.
   *
   * @param error - The caught value.
   * @returns The classified Typemo error, or a new `TypemoError` with `error` as its `cause`.
   */
  private static typemo(error: unknown): TypemoError {
    const wrapped = ErrorTranslator.wrap(error);
    return wrapped instanceof TypemoError ? wrapped : new TypemoError(String(error), { cause: error });
  }
}
