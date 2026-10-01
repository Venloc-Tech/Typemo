import type { Binary, ObjectId, ResumeToken, Timestamp, UUID } from "mongodb";
import type { DateUnit } from "../expressions/ops/date-ops.ts";
import type { DocPaths } from "../types/path-types.ts";

/*
 * Input shapes of the stages that are not expressions, and the row types of the stages whose output
 * is not derived from the document (statistics, sessions, operations). Row types are the lean forms
 * the driver returns with the enforced BSON options (int64 → `bigint`); each one is checked against a
 * real server by a shape test where the server can run the stage.
 */

/**
 * A document of unknown shape (`unknown` values: the driver's `Document` has `any` values).
 *
 * @example
 * ```ts
 * const doc: AnyDocument = { a: 1, nested: { b: "x" } };
 * ```
 */
export type AnyDocument = { [key: string]: unknown };

/* ---- geo ---- */

/**
 * A GeoJSON point, or a legacy `[longitude, latitude]` pair.
 *
 * @example
 * ```ts
 * const a: GeoPointInput = { type: "Point", coordinates: [13.4, 52.5] };
 * const b: GeoPointInput = [13.4, 52.5];
 * ```
 */
export type GeoPointInput =
  | { readonly type: "Point"; readonly coordinates: readonly [number, number] }
  | readonly [number, number];

/* ---- $densify ---- */

/**
 * `range` of `$densify`: numbers step without a unit, dates need one.
 *
 * @typeParam V - The type of the densified field.
 * @example
 * ```ts
 * const numbers: DensifyRange<number> = { step: 10, bounds: "full" };
 * const dates: DensifyRange<Date> = { step: 1, unit: "day", bounds: "partition" };
 * ```
 */
export type DensifyRange<V> = [NonNullable<V>] extends [Date]
  ? { readonly step: number; readonly unit: DateUnit; readonly bounds: "full" | "partition" | readonly [Date, Date] }
  : { readonly step: number; readonly bounds: "full" | "partition" | readonly [number, number] };

/* ---- Atlas Search (typed on input) ---- */

/**
 * A search path: a field, several fields, a wildcard, or an analyzer variant.
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * interface Article {
 *   title: string;
 *   body: string;
 * }
 * const a: SearchPath<Article> = "title";
 * const b: SearchPath<Article> = { wildcard: "*" };
 * const c: SearchPath<Article> = { value: "title", multi: "english" };
 * ```
 */
export type SearchPath<T> =
  | DocPaths<T>
  | readonly DocPaths<T>[]
  | { readonly wildcard: string }
  | { readonly value: DocPaths<T>; readonly multi: string };

/**
 * A score modifier.
 *
 * @example
 * ```ts
 * const a: SearchScore = { boost: { value: 2 } };
 * const b: SearchScore = { constant: { value: 1 } };
 * ```
 */
export type SearchScore =
  | { readonly boost: { readonly value: number } | { readonly path: string; readonly undefined?: number } }
  | { readonly constant: { readonly value: number } }
  | { readonly function: AnyDocument };

/**
 * The members shared by most Atlas Search operators.
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * const common: SearchCommon<Article> = { path: "title", score: { boost: { value: 2 } } };
 * ```
 */
interface SearchCommon<T> {
  /** The field or fields to search. */
  readonly path: SearchPath<T>;
  /** The score modifier. */
  readonly score?: SearchScore;
}

/**
 * One Atlas Search operator (the common ones; `compound` nests them).
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * interface Article {
 *   title: string;
 * }
 * const op: SearchOperator<Article> = { text: { path: "title", query: "mongo" } };
 * const nested: SearchOperator<Article> = { compound: { must: [op] } };
 * ```
 */
export type SearchOperator<T> =
  | {
      readonly text: SearchCommon<T> & {
        readonly query: string | readonly string[];
        readonly fuzzy?: { readonly maxEdits?: 1 | 2; readonly prefixLength?: number; readonly maxExpansions?: number };
        readonly matchCriteria?: "any" | "all";
        readonly synonyms?: string;
      };
    }
  | { readonly phrase: SearchCommon<T> & { readonly query: string | readonly string[]; readonly slop?: number } }
  | {
      readonly autocomplete: SearchCommon<T> & {
        readonly query: string | readonly string[];
        readonly tokenOrder?: "any" | "sequential";
        readonly fuzzy?: { readonly maxEdits?: 1 | 2; readonly prefixLength?: number };
      };
    }
  | {
      readonly equals: SearchCommon<T> & {
        readonly value: string | number | boolean | Date | ObjectId | UUID | null;
      };
    }
  | { readonly exists: SearchCommon<T> }
  | {
      readonly range: SearchCommon<T> & {
        readonly gt?: number | Date | string;
        readonly gte?: number | Date | string;
        readonly lt?: number | Date | string;
        readonly lte?: number | Date | string;
      };
    }
  | {
      readonly regex: SearchCommon<T> & {
        readonly query: string | readonly string[];
        readonly allowAnalyzedField?: boolean;
      };
    }
  | {
      readonly wildcard: SearchCommon<T> & {
        readonly query: string | readonly string[];
        readonly allowAnalyzedField?: boolean;
      };
    }
  | {
      readonly in: SearchCommon<T> & {
        readonly value: readonly (string | number | boolean | Date | ObjectId | UUID)[];
      };
    }
  | {
      readonly near: SearchCommon<T> & {
        readonly origin: number | Date | GeoPointInput;
        readonly pivot: number;
      };
    }
  | {
      readonly queryString: { readonly defaultPath: DocPaths<T>; readonly query: string; readonly score?: SearchScore };
    }
  | { readonly moreLikeThis: { readonly like: AnyDocument | readonly AnyDocument[]; readonly score?: SearchScore } }
  | {
      readonly compound: {
        readonly must?: readonly SearchOperator<T>[];
        readonly mustNot?: readonly SearchOperator<T>[];
        readonly should?: readonly SearchOperator<T>[];
        readonly filter?: readonly SearchOperator<T>[];
        readonly minimumShouldMatch?: number;
        readonly score?: SearchScore;
      };
    };

/**
 * `$search`: an index name and one operator (or a `facet` collector for `$searchMeta`).
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * interface Article {
 *   title: string;
 * }
 * const spec: SearchSpec<Article> = { index: "default", text: { path: "title", query: "mongo" } };
 * ```
 */
export type SearchSpec<T> = SearchOperator<T> & {
  /** The name of the search index. */
  readonly index?: string;
  /** Highlighting of matched terms. */
  readonly highlight?: {
    readonly path: SearchPath<T>;
    readonly maxCharsToExamine?: number;
    readonly maxNumPassages?: number;
  };
  /** How the total number of matches is counted. */
  readonly count?: { readonly type: "lowerBound" | "total"; readonly threshold?: number };
  /** Whether to return stored source fields instead of reading the documents. */
  readonly returnStoredSource?: boolean;
  /** Whether to return the score details. */
  readonly scoreDetails?: boolean;
  /** The sort of the results, by field. */
  readonly sort?: { readonly [P in DocPaths<T>]?: 1 | -1 | { readonly order: 1 | -1 } };
  /** Whether the query may run concurrently on the search nodes. */
  readonly concurrent?: boolean;
  /** Search analytics tracking. */
  readonly tracking?: { readonly searchTerms: string };
};

/**
 * The row of `$searchMeta`.
 *
 * @example
 * ```ts
 * const row: SearchMetaRow = { count: { lowerBound: 10n } };
 * ```
 */
export interface SearchMetaRow {
  /** The count of matches. */
  count?: { lowerBound?: bigint; total?: bigint };
  /** The facet buckets by facet name. */
  facet?: { [name: string]: { buckets: { _id: unknown; count: bigint }[] } };
}

/**
 * `$vectorSearch`.
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * interface Article {
 *   embedding: number[];
 * }
 * const spec: VectorSearchSpec<Article> = { index: "vec", path: "embedding", queryVector: [0.1, 0.2], limit: 5 };
 * ```
 */
export interface VectorSearchSpec<T> {
  /** The name of the vector search index. */
  readonly index: string;
  /** The field that holds the vectors. */
  readonly path: DocPaths<T>;
  /** The query vector: numbers or a `binData` vector. */
  readonly queryVector: readonly number[] | Binary;
  /** The number of results. */
  readonly limit: number;
  /** The number of nearest-neighbour candidates to consider. */
  readonly numCandidates?: number;
  /** Whether to run an exact (not approximate) search. */
  readonly exact?: boolean;
  /** A pre-filter over indexed fields. */
  readonly filter?: AnyDocument;
}

/* ---- $changeStream ---- */

/**
 * `$changeStream` options (the stage form of `watch`).
 *
 * @example
 * ```ts
 * const spec: ChangeStreamStageSpec = { fullDocument: "updateLookup", showExpandedEvents: true };
 * ```
 */
export interface ChangeStreamStageSpec {
  /** Whether update events carry the full document. */
  readonly fullDocument?: "default" | "updateLookup" | "whenAvailable" | "required";
  /** Whether events carry the document as it was before the change. */
  readonly fullDocumentBeforeChange?: "off" | "whenAvailable" | "required";
  /** Resumes after this token. */
  readonly resumeAfter?: ResumeToken;
  /** Resumes after this token, also after an invalidate event. */
  readonly startAfter?: ResumeToken;
  /** Starts at this operation time. */
  readonly startAtOperationTime?: Timestamp;
  /** Whether to show expanded events (DDL and others). */
  readonly showExpandedEvents?: boolean;
}

/**
 * `$changeStreamSplitLargeEvent` adds the fragment position to split events.
 *
 * @example
 * ```ts
 * const fields: SplitEventFields = { splitEvent: { fragment: 1, of: 3 } };
 * ```
 */
export interface SplitEventFields {
  /** The position of this fragment among the fragments of the event. */
  splitEvent?: { fragment: number; of: number };
}

/* ---- statistics, sessions, operations ---- */

/**
 * `$collStats` options; each requested section appears in the row.
 *
 * @example
 * ```ts
 * const spec: CollStatsSpec = { storageStats: { scale: 1024 }, count: {} };
 * ```
 */
export interface CollStatsSpec {
  /** Latency statistics. */
  readonly latencyStats?: { readonly histograms?: boolean };
  /** Storage statistics, with an optional scale factor. */
  readonly storageStats?: { readonly scale?: number };
  /** The document count. */
  readonly count?: Record<string, never>;
  /** Query execution statistics. */
  readonly queryExecStats?: Record<string, never>;
}

/**
 * Numbers of server statistics: int32/double (`number`) or int64 (`bigint`), depending on the value. The server
 * writes a counter as int32 while it is small and as int64 once it is large (`$collStats` `count` of a small
 * collection is an int32, so a `number`), so one statistic can arrive as either: narrowing it to `number` would
 * be wrong for a large collection. Compare with `Number(value)` or a `typeof` check.
 *
 * @example
 * ```ts
 * const values: StatNumber[] = [12, 12n];
 * ```
 */
export type StatNumber = number | bigint;

/**
 * The row of `$collStats` for the requested sections.
 *
 * @typeParam S - The `$collStats` spec type.
 * @example
 * ```ts
 * type Row = CollStatsRow<{ count: {} }>; // { ns: string; host: string; localTime: Date } & { count: StatNumber }
 * ```
 */
export type CollStatsRow<S> = {
  ns: string;
  host: string;
  localTime: Date;
} & (S extends { latencyStats: object } ? { latencyStats: { [op: string]: AnyDocument } } : unknown) &
  (S extends { storageStats: object } ? { storageStats: { [key: string]: unknown } } : unknown) &
  (S extends { count: object } ? { count: StatNumber } : unknown) &
  (S extends { queryExecStats: object } ? { queryExecStats: AnyDocument } : unknown);

/**
 * A row of `$indexStats`.
 *
 * @example
 * ```ts
 * const row: IndexStatsRow = {
 *   name: "email_1", key: { email: 1 }, host: "db:27017", accesses: { ops: 5n, since: new Date() }, spec: {},
 * };
 * ```
 */
export interface IndexStatsRow {
  /** The index name. */
  name: string;
  /** The index key. */
  key: { [path: string]: 1 | -1 | "text" | "2dsphere" | "2d" | "hashed" };
  /** The host that reports the statistics. */
  host: string;
  /** How often the index was used and since when. */
  accesses: { ops: bigint; since: Date };
  /** The index specification. */
  spec: AnyDocument;
  /** Set while the index is being built. */
  building?: boolean;
}

/**
 * A row of `$listSessions` / `$listLocalSessions`.
 *
 * @example
 * ```ts
 * const row: SessionRow = { _id: { id: new UUID(), uid: new Binary() }, lastUse: new Date() };
 * ```
 */
export interface SessionRow {
  /** The session id and the id of its user. */
  _id: { id: UUID; uid: Binary };
  /** When the session was last used. */
  lastUse: Date;
  /** The user of the session, when authenticated. */
  user?: { name: string };
}

/**
 * `$listSessions` / `$listLocalSessions` options.
 *
 * @example
 * ```ts
 * const all: ListSessionsSpec = { allUsers: true };
 * const some: ListSessionsSpec = { users: [{ user: "alice", db: "admin" }] };
 * ```
 */
export type ListSessionsSpec =
  | { readonly allUsers: true }
  | { readonly users: readonly { readonly user: string; readonly db: string }[] }
  | Record<string, never>;

/**
 * `$currentOp` options.
 *
 * @example
 * ```ts
 * const spec: CurrentOpSpec = { allUsers: true, idleConnections: false };
 * ```
 */
export interface CurrentOpSpec {
  /** Whether to list the operations of all users. */
  readonly allUsers?: boolean;
  /** Whether to include idle connections. */
  readonly idleConnections?: boolean;
  /** Whether to include idle cursors. */
  readonly idleCursors?: boolean;
  /** Whether to include idle sessions. */
  readonly idleSessions?: boolean;
  /** Whether to report operations of this node only (sharded clusters). */
  readonly localOps?: boolean;
  /** Whether to include the backtrace of the operations. */
  readonly backtrace?: boolean;
}

/**
 * A row of `$currentOp` (the fields every operation has; the rest depends on the operation).
 *
 * @example
 * ```ts
 * const row: CurrentOpRow = { type: "op", active: true, op: "query", ns: "shop.orders" };
 * ```
 */
export type CurrentOpRow = {
  type: string;
  active?: boolean;
  op?: string;
  ns?: string;
  opid?: number | string;
} & { [field: string]: unknown };

/**
 * `$planCacheStats` options.
 *
 * @example
 * ```ts
 * const spec: PlanCacheStatsSpec = { allHosts: true };
 * ```
 */
export interface PlanCacheStatsSpec {
  /** Whether to report the plan cache of all hosts. */
  readonly allHosts?: boolean;
}

/**
 * A row of `$planCacheStats`.
 *
 * @example
 * ```ts
 * const row: PlanCacheStatsRow = { planCacheKey: "A1B2", isActive: true, works: 12n };
 * ```
 */
export type PlanCacheStatsRow = {
  planCacheShapeHash?: string;
  planCacheKey?: string;
  isActive?: boolean;
  works?: bigint;
  timeOfCreation?: Date;
  host?: string;
} & { [field: string]: unknown };

/**
 * `$queryStats` options.
 *
 * @example
 * ```ts
 * const key = new Binary(crypto.getRandomValues(new Uint8Array(32)));
 * const spec: QueryStatsSpec = { transformIdentifiers: { algorithm: "hmac-sha-256", hmacKey: key } };
 * ```
 */
export interface QueryStatsSpec {
  /** Hashes field names and values in the reported query shapes. */
  readonly transformIdentifiers?: { readonly algorithm: "hmac-sha-256"; readonly hmacKey: Binary };
}

/**
 * A row of `$queryStats`.
 *
 * @example
 * ```ts
 * const row: QueryStatsRow = { key: {}, keyHash: "abc", metrics: {}, asOf: new Date() };
 * ```
 */
export type QueryStatsRow = {
  key: AnyDocument;
  keyHash: string;
  queryShapeHash?: string;
  metrics: AnyDocument;
  asOf: Date;
} & { [field: string]: unknown };

/**
 * A row of `$listSearchIndexes`.
 *
 * @example
 * ```ts
 * const row: SearchIndexRow = { id: "1", name: "default", status: "READY", queryable: true, latestDefinition: {} };
 * ```
 */
export type SearchIndexRow = {
  id: string;
  name: string;
  status: string;
  queryable: boolean;
  latestDefinition: AnyDocument;
} & { [field: string]: unknown };

/**
 * A row of `$listClusterCatalog`.
 *
 * @example
 * ```ts
 * const row: ClusterCatalogRow = { db: "shop", ns: "shop.orders", type: "collection" };
 * ```
 */
export type ClusterCatalogRow = {
  db: string;
  ns: string;
  type: "collection" | "view" | "timeseries";
  sharded?: boolean;
} & { [field: string]: unknown };

/**
 * `$listClusterCatalog` options.
 *
 * @example
 * ```ts
 * const spec: ClusterCatalogSpec = { shards: true };
 * ```
 */
export interface ClusterCatalogSpec {
  /** Whether to include the shards of each collection. */
  readonly shards?: boolean;
  /** Whether to include the balancing configuration. */
  readonly balancingConfiguration?: boolean;
}

/**
 * A row of `$listSampledQueries`.
 *
 * @example
 * ```ts
 * const row: SampledQueryRow = {
 *   _id: new UUID(), ns: "shop.orders", collectionUuid: new UUID(), cmdName: "find", cmd: {}, expireAt: new Date(),
 * };
 * ```
 */
export type SampledQueryRow = {
  _id: UUID;
  ns: string;
  collectionUuid: UUID;
  cmdName: "find" | "aggregate" | "count" | "distinct" | "update" | "delete" | "findAndModify";
  cmd: AnyDocument;
  expireAt: Date;
} & { [field: string]: unknown };

/**
 * A row of `$shardedDataDistribution`.
 *
 * @example
 * ```ts
 * const row: ShardedDataDistributionRow = { ns: "shop.orders", shards: [] };
 * ```
 */
export interface ShardedDataDistributionRow {
  /** The namespace of the sharded collection. */
  ns: string;
  /** The data distribution per shard. */
  shards: {
    shardName: string;
    numOrphanedDocs: StatNumber;
    numOwnedDocuments: StatNumber;
    ownedSizeBytes: StatNumber;
    orphanedSizeBytes: StatNumber;
  }[];
}

/**
 * A row of `$querySettings`.
 *
 * @example
 * ```ts
 * const row: QuerySettingsRow = { queryShapeHash: "abc", settings: { reject: true } };
 * ```
 */
export type QuerySettingsRow = {
  queryShapeHash: string;
  settings: AnyDocument;
  representativeQuery?: AnyDocument;
} & { [field: string]: unknown };

/* ---- $out, $merge ---- */

/**
 * Time series options of `$out`.
 *
 * @example
 * ```ts
 * const options: OutTimeseries = { timeField: "at", metaField: "sensor", granularity: "minutes" };
 * ```
 */
export interface OutTimeseries {
  /** The field that holds the timestamp of each measurement. */
  readonly timeField: string;
  /** The field that holds the metadata of the series. */
  readonly metaField?: string;
  /** The granularity of the buckets. */
  readonly granularity?: "seconds" | "minutes" | "hours";
  /** The maximum time span of a bucket, in seconds. */
  readonly bucketMaxSpanSeconds?: number;
  /** The rounding of the bucket boundaries, in seconds. */
  readonly bucketRoundingSeconds?: number;
}

/**
 * A named target collection (no entity, so the row is not checked against a class).
 *
 * @example
 * ```ts
 * const target: NamedCollection = { db: "shop", coll: "archive" };
 * ```
 */
export interface NamedCollection {
  /** The database; the aggregation's own when omitted. */
  readonly db?: string;
  /** The collection name. */
  readonly coll: string;
}

/**
 * The target of `$out` by name: a collection of the aggregation's database, or `{ db, coll }` with
 * BOTH fields (the server refuses `{ coll }` alone: "$out must have a 'db' field"); time series options
 * only in the object form.
 *
 * @example
 * ```ts
 * const a: OutCollection = "archive";
 * const b: OutCollection = { db: "shop", coll: "archive", timeseries: { timeField: "at" } };
 * ```
 */
export type OutCollection =
  | string
  | { readonly db: string; readonly coll: string; readonly timeseries?: OutTimeseries };

/**
 * `$merge.whenMatched` keywords (a pipeline is the other form).
 *
 * @example
 * ```ts
 * const mode: MergeWhenMatched = "keepExisting";
 * ```
 */
export type MergeWhenMatched = "replace" | "keepExisting" | "merge" | "fail";

/**
 * `$merge.whenNotMatched`.
 *
 * @example
 * ```ts
 * const mode: MergeWhenNotMatched = "insert";
 * ```
 */
export type MergeWhenNotMatched = "insert" | "discard" | "fail";

/**
 * `$score` normalization.
 *
 * @example
 * ```ts
 * const normalization: ScoreNormalization = "sigmoid";
 * ```
 */
export type ScoreNormalization = "none" | "sigmoid" | "minMaxScaler";
