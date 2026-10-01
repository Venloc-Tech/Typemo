import type { ClientSession, CollationOptions, ReadConcernLevel, ReadPreferenceMode, W } from "mongodb";
import type { CursorSource } from "../cursor/typed-cursor.ts";
import type { PlainReadOptions } from "../model/plain-reader.ts";
import type { PolicyValues } from "../policies/policy-context.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import type { ExplainVerbosity } from "../types/result.ts";

/*
 * `OperationPlan`: the immutable description of ONE operation that a query builder produces and the
 * operation pipeline executes. A plan is data: filters, updates and projections are deep copies of the
 * user's input (never the input itself), frozen; `$expr` callbacks are already compiled into expressions
 * (`ExprCompiler.compileExpr`, via `PlanValues.filter`). Nothing here is cast or checked against the schema
 * yet: that is the pipeline's job (path resolution, cast, policies). A builder does check what needs no
 * schema (`limit > 0`, projection mixing, empty `$and`, `undefined` values).
 */

/**
 * A plain document inside a plan (filter, update, projection…), frozen.
 *
 * @example
 * const filter: PlanDocument = Object.freeze({ age: { $gt: 18 } });
 */
export type PlanDocument = Readonly<Record<string, unknown>>;

/**
 * Operations that return documents of the model.
 *
 * @example
 * const op: FindOperation = "findOne";
 */
export type FindOperation = "find" | "findOne";

/**
 * Find-and-modify operations (return one document before or after the change).
 *
 * @example
 * const op: ModifyOperation = "findOneAndUpdate";
 */
export type ModifyOperation = "findOneAndUpdate" | "findOneAndReplace" | "findOneAndDelete";

/**
 * Write operations with a driver result.
 *
 * @example
 * const op: WriteOperation = "deleteMany";
 */
export type WriteOperation = "updateOne" | "updateMany" | "replaceOne" | "deleteOne" | "deleteMany";

/**
 * Operations that return a value (a number, distinct values).
 *
 * @example
 * const op: ValueOperation = "distinct";
 */
export type ValueOperation = "countDocuments" | "estimatedDocumentCount" | "distinct";

/**
 * Every operation a plan can describe.
 *
 * @example
 * const op: OperationKind = "updateOne";
 */
export type OperationKind = FindOperation | ModifyOperation | WriteOperation | ValueOperation;

/**
 * One sort key in order: a direction or the text score.
 *
 * @example
 * const byAge: SortPair = ["age", -1];
 * const byScore: SortPair = ["score", { $meta: "textScore" }];
 */
export type SortPair = readonly [path: string, direction: 1 | -1 | { readonly $meta: "textScore" }];

/**
 * A write concern of a write operation.
 *
 * @example
 * const concern: PlanWriteConcern = { w: "majority", journal: true };
 */
export interface PlanWriteConcern {
  /** How many members must acknowledge the write. */
  readonly w?: W;
  /** Whether the write must reach the journal. */
  readonly journal?: boolean;
}

/**
 * Options shared by all operations (driver options, CSOT only: `timeoutMS`).
 *
 * @example
 * const options: PlanOptions = { comment: "report", timeoutMS: 2000 };
 */
export interface PlanOptions {
  /**
   * The session: an explicit one, or `null` to run OUTSIDE the ambient transaction;
   * absent = the ambient transaction's session when there is one.
   */
  readonly session?: ClientSession | null;
  /** The index to force: a name or a key pattern. */
  readonly hint?: string | PlanDocument;
  /** String comparison rules. */
  readonly collation?: CollationOptions;
  /** A comment for the profiler and the logs. */
  readonly comment?: string;
  /** The client-side operation timeout in milliseconds. */
  readonly timeoutMS?: number;
  /** Which members serve a read. */
  readonly readPreference?: ReadPreferenceMode;
  /** The read concern level. */
  readonly readConcern?: ReadConcernLevel;
  /** The write concern of a write. */
  readonly writeConcern?: PlanWriteConcern;
  /** The number of documents per cursor batch. */
  readonly batchSize?: number;
  /** Whether the server may use disk for large sorts. */
  readonly allowDiskUse?: boolean;
  /**
   * The policy context of the operation (tenant, actor, soft delete view): the ambient scope when the
   * operation was built (`PolicyContext.run`), with the explicit `.policy({...})` values over it.
   */
  readonly policy?: Readonly<PolicyValues>;
  /**
   * The method the user called, when it is not the operation itself (`create` runs as `insertOne` or
   * `bulkWrite`, `findById` as `findOne`, an aggregation with `$out` as a write): error texts name this method,
   * never the internal operation.
   */
  readonly method?: string;
  /**
   * `.validateReads(enabled)` of a read: check the documents read against the schema (`true`) or not (`false`);
   * absent = the client's `validateReads`.
   */
  readonly validateReads?: boolean;
}

/**
 * A populate instruction (object form normalized; the populate layer executes it).
 *
 * @example
 * const plan: PopulatePlan = { path: "author", select: { name: 1 }, populate: [] };
 */
export interface PopulatePlan {
  /** The path to populate. */
  readonly path: string;
  /** The projection of the populated documents. */
  readonly select?: PlanDocument;
  /** A filter of the populated model, combined with the virtual's own `match` by `$and`. */
  readonly match?: PlanDocument;
  /**
   * `match` given as a function of the document being populated: it runs once per document and
   * each document gets its OWN populate query with that filter (server semantics, no client-side filter).
   */
  readonly matchFn?: (document: never) => unknown;
  /** Replaces each populated value (`doc` is `null` for a missing document; `id` the local value). */
  readonly transform?: (doc: never, id: never) => unknown;
  /** Sort, limit and skip of the populate query. */
  readonly options?: {
    /** The sort of the populated documents. */
    readonly sort?: readonly SortPair[];
    /** At most this many documents. */
    readonly limit?: number;
    /** Skipped documents. */
    readonly skip?: number;
  };
  /** At most this many documents per owner. */
  readonly perDocumentLimit?: number;
  /** Forces one document (`true`) or a list (`false`). */
  readonly justOne?: boolean;
  /** Keeps a `null` in the list for each reference that found nothing. */
  readonly retainNullValues?: boolean;
  /** A reference that finds nothing is an error (`DocumentNotFoundError`), never `null`. */
  readonly required?: boolean;
  /** Every owner gets its own copy of a populated document (off: one shared object per document). */
  readonly clone?: boolean;
  /** Populate instructions for the populated documents. */
  readonly populate: readonly PopulatePlan[];
}

/**
 * How a find is consumed: to completion, as a cursor, or explained.
 *
 * @example
 * const mode: FindMode = { kind: "explain", verbosity: "executionStats" };
 */
export type FindMode =
  | { readonly kind: "run" }
  | { readonly kind: "cursor" }
  | { readonly kind: "explain"; readonly verbosity: ExplainVerbosity };

/**
 * The fields every plan has.
 *
 * @typeParam Op - The operation kind.
 * @example
 * type Base = PlanBase<"find">; // { op: "find"; entity: EntityClass; options: PlanOptions }
 */
interface PlanBase<Op extends OperationKind> {
  /** The operation kind. */
  readonly op: Op;
  /** The entity class of the model; the pipeline compiles its schema. */
  readonly entity: EntityClass;
  /** The options shared by all operations. */
  readonly options: PlanOptions;
}

/**
 * `find` / `findOne`.
 *
 * @example
 * const plan: FindPlan = { op: "find", entity: User, options: {}, filter: {}, populate: [], lean: false,
 *   orFail: false, mode: { kind: "run" } };
 */
export interface FindPlan extends PlanBase<FindOperation> {
  /** The filter. */
  readonly filter: PlanDocument;
  /** The user's projection; the pipeline adds the default exclusion of `Hidden` fields (`ProjectionPlanner`). */
  readonly projection?: PlanDocument;
  /** The sort keys in order. */
  readonly sort?: readonly SortPair[];
  /** Documents to skip. */
  readonly skip?: number;
  /** Maximum number of documents. */
  readonly limit?: number;
  /** The populate instructions. */
  readonly populate: readonly PopulatePlan[];
  /** Whether rows are returned lean (plain objects) instead of hydrated. */
  readonly lean: boolean;
  /** The lean rows are returned in their plain form (`.plain()`; `lean` is `true` then). */
  readonly plain?: PlainReadOptions;
  /** No document (`findOne`) is an error (`DocumentNotFoundError`). */
  readonly orFail: boolean;
  /** How the find is consumed. */
  readonly mode: FindMode;
}

/**
 * `findOneAndUpdate` / `findOneAndReplace` / `findOneAndDelete`.
 *
 * @example
 * const kind: ModifyPlan["op"] = "findOneAndUpdate";
 */
export interface ModifyPlan extends PlanBase<ModifyOperation> {
  /** The filter. */
  readonly filter: PlanDocument;
  /** The update document or pipeline (`findOneAndUpdate`). */
  readonly update?: PlanDocument | readonly PlanDocument[];
  /** The replacement document (`findOneAndReplace`). */
  readonly replacement?: PlanDocument;
  /** The filters of `$[id]` positional updates. */
  readonly arrayFilters?: readonly PlanDocument[];
  /** Whether to insert when nothing matches. */
  readonly upsert: boolean;
  /** `"after"` unless asked otherwise. */
  readonly returnDocument: "before" | "after";
  /** The user's projection. */
  readonly projection?: PlanDocument;
  /** The sort that picks the document. */
  readonly sort?: readonly SortPair[];
  /** The populate instructions. */
  readonly populate: readonly PopulatePlan[];
  /** Whether the document is returned lean. */
  readonly lean: boolean;
  /** The lean document is returned in its plain form (`.plain()`; `lean` is `true` then). */
  readonly plain?: PlainReadOptions;
  /** No matching document is an error. */
  readonly orFail: boolean;
  /** Whether the raw driver result (with `lastErrorObject`) is returned. */
  readonly includeResultMetadata: boolean;
}

/**
 * `updateOne` / `updateMany` / `replaceOne` / `deleteOne` / `deleteMany`.
 *
 * @example
 * const kind: WritePlan["op"] = "deleteMany";
 */
export interface WritePlan extends PlanBase<WriteOperation> {
  /** The filter. */
  readonly filter: PlanDocument;
  /** The update document or pipeline. */
  readonly update?: PlanDocument | readonly PlanDocument[];
  /** The replacement document (`replaceOne`). */
  readonly replacement?: PlanDocument;
  /** The filters of `$[id]` positional updates. */
  readonly arrayFilters?: readonly PlanDocument[];
  /** Whether to insert when nothing matches. */
  readonly upsert: boolean;
  /** Nothing matched is an error. */
  readonly orFail: boolean;
}

/**
 * `countDocuments` / `estimatedDocumentCount` / `distinct`.
 *
 * @example
 * const kind: ValuePlan["op"] = "distinct";
 */
export interface ValuePlan extends PlanBase<ValueOperation> {
  /** The filter. */
  readonly filter: PlanDocument;
  /** `distinct` only: the path of the values. */
  readonly field?: string;
  /** Documents to skip (`countDocuments`). */
  readonly skip?: number;
  /** Maximum number of documents (`countDocuments`). */
  readonly limit?: number;
}

/**
 * The immutable description of one operation.
 *
 * @example
 * const plan: OperationPlan = query.build();
 */
export type OperationPlan = FindPlan | ModifyPlan | WritePlan | ValuePlan;

/** A cursor over results (`for await`, `next`, `toArray`, `close`, `eachAsync`, `map`). */
export type { CursorSource, QueryCursor } from "../cursor/typed-cursor.ts";

/**
 * Runs plans. The operation pipeline implements it; builders only build and hand over.
 * Results are `unknown` here: the builder's type automaton gives them their type, and the shape tests
 * prove the two agree.
 *
 * @example
 * const result = await executor.execute(query.build());
 */
export interface PlanExecutor {
  /** Runs a plan to completion. */
  readonly execute: (plan: OperationPlan) => Promise<unknown>;
  /** Streams the documents of a find plan (the builder wraps the source in a `QueryCursor`). */
  readonly cursor: (plan: FindPlan) => CursorSource<unknown>;
  /** The compiled schema of the model the plans belong to (the checks of `.mask()` paths), when known. */
  readonly schema?: CompiledSchema;
}
