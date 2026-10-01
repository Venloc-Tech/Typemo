import type { ChangeStreamOptions } from "mongodb";
import type { AggregateOptions, PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import type { OperationPlan, PlanDocument, PlanOptions, SortPair } from "../../query/plan.ts";
import type { EntityClass } from "../../schema/options/type-spec.ts";

/*
 * The plans the operation pipeline executes. `OperationPlan` covers the queries and the filter-based writes; the
 * model adds the plans that have no builder: inserts, `bulkWrite`, aggregations and change streams. Every plan is
 * immutable data: values are frozen deep copies of the user's input, nothing is cast yet (that is the pipeline's job).
 */

/**
 * `insertOne` / `insertMany` (also `create`).
 *
 * @example
 * ```ts
 * const plan: InsertPlan = { op: "insertOne", entity: User, documents: [{ name: "Ann" }], ordered: true, options: {} };
 * ```
 */
export interface InsertPlan {
  /** The operation name. */
  readonly op: "insertOne" | "insertMany";
  /** The entity class of the model. */
  readonly entity: EntityClass;
  /** The documents as given (frozen copies), in code names; the pipeline casts them and adds defaults. */
  readonly documents: readonly PlanDocument[];
  /** `insertMany`: stop at the first failing document (`true`, default) or insert every valid one. */
  readonly ordered: boolean;
  /** The options of the operation. */
  readonly options: PlanOptions;
}

/**
 * One write of a `bulkWrite` (the driver's `AnyBulkWriteOperation`, typed by the entity in `model/`).
 *
 * @example
 * ```ts
 * const model: BulkWriteModel = { deleteOne: { filter: { name: "Ann" } } };
 * ```
 */
export type BulkWriteModel =
  | { readonly insertOne: { readonly document: PlanDocument } }
  | {
      readonly updateOne: {
        readonly filter: PlanDocument;
        readonly update: PlanDocument | readonly PlanDocument[];
        readonly upsert?: boolean;
        readonly arrayFilters?: readonly PlanDocument[];
        readonly hint?: string | PlanDocument;
      };
    }
  | {
      readonly updateMany: {
        readonly filter: PlanDocument;
        readonly update: PlanDocument | readonly PlanDocument[];
        readonly upsert?: boolean;
        readonly arrayFilters?: readonly PlanDocument[];
        readonly hint?: string | PlanDocument;
      };
    }
  | {
      readonly replaceOne: {
        readonly filter: PlanDocument;
        readonly replacement: PlanDocument;
        readonly upsert?: boolean;
        readonly hint?: string | PlanDocument;
      };
    }
  | { readonly deleteOne: { readonly filter: PlanDocument; readonly hint?: string | PlanDocument } }
  | { readonly deleteMany: { readonly filter: PlanDocument; readonly hint?: string | PlanDocument } };

/**
 * The plan of `bulkWrite`.
 *
 * @example
 * ```ts
 * const plan: BulkWritePlan = { op: "bulkWrite", entity: User, operations: [], ordered: true, options: {} };
 * ```
 */
export interface BulkWritePlan {
  /** The operation name. */
  readonly op: "bulkWrite";
  /** The entity class of the model. */
  readonly entity: EntityClass;
  /** Frozen copies of the operations (the input is never mutated: a Mongoose grievance). */
  readonly operations: readonly BulkWriteModel[];
  /** Stop at the first failing operation (`true`) or run every valid one. */
  readonly ordered: boolean;
  /** The options of the operation. */
  readonly options: PlanOptions;
}

/**
 * The execution plan of a model aggregation (`Model.aggregate(...).build()`): the stages and options of the
 * builder's `AggregatePlan` bound to the model (`entity`, `aggregateOptions`) plus the options of this run
 * (`options`: `session`, `timeoutMS`, `policy`, …). The builder's own plan (`PipelineBuilder.plan()`) has the
 * source (`target`) and no execution options.
 *
 * @example
 * ```ts
 * const plan: AggregateExecutionPlan = {
 *   op: "aggregate",
 *   entity: User,
 *   pipeline: [],
 *   aggregateOptions: {},
 *   options: {},
 * };
 * ```
 */
export interface AggregateExecutionPlan {
  /** The operation name. */
  readonly op: "aggregate";
  /** The entity class of the model. */
  readonly entity: EntityClass;
  /** The stages of the aggregation. */
  readonly pipeline: readonly PipelineStage[];
  /** The builder's options (`hint`, `collation`, `allowDiskUse`, …) plus execution options. */
  readonly aggregateOptions: AggregateOptions<unknown>;
  /** The options of the operation. */
  readonly options: PlanOptions;
}

/**
 * Options of a change stream Typemo passes to the driver (`Model.watch` checks them).
 *
 * @example
 * ```ts
 * const options: WatchOptions = { fullDocument: "updateLookup" };
 * ```
 */
export type WatchOptions = Pick<
  ChangeStreamOptions,
  | "fullDocument"
  | "fullDocumentBeforeChange"
  | "resumeAfter"
  | "startAfter"
  | "startAtOperationTime"
  | "maxAwaitTimeMS"
  | "batchSize"
  | "showExpandedEvents"
>;

/**
 * The plan of `Model.watch()`; its stages include the discriminator filter and the hidden-field `$unset`.
 *
 * @example
 * ```ts
 * const plan: WatchPlan = { op: "watch", entity: User, pipeline: [], watchOptions: {}, options: {} };
 * ```
 */
export interface WatchPlan {
  /** The operation name. */
  readonly op: "watch";
  /** The entity class of the model. */
  readonly entity: EntityClass;
  /** The stages of the change stream. */
  readonly pipeline: readonly PipelineStage[];
  /** The change stream options. */
  readonly watchOptions: WatchOptions;
  /** The options of the operation. */
  readonly options: PlanOptions;
}

/**
 * Every plan the pipeline runs.
 *
 * @example
 * ```ts
 * const plan: ExecutionPlan = { op: "watch", entity: User, pipeline: [], watchOptions: {}, options: {} };
 * ```
 */
export type ExecutionPlan = OperationPlan | InsertPlan | BulkWritePlan | AggregateExecutionPlan | WatchPlan;

/**
 * The name of an operation (the `op` of its plan).
 *
 * @example
 * ```ts
 * const name: OperationName = "find";
 * ```
 */
export type OperationName = ExecutionPlan["op"];

/**
 * How the result is consumed: to completion, as a cursor, or explained (find/findOne/aggregate).
 *
 * @example
 * ```ts
 * const mode: ExecutionMode = "cursor";
 * ```
 */
export type ExecutionMode = "run" | "cursor" | "explain";

/** Operations that write (a transaction refuses a per-operation write concern on them). */
export const WRITE_OPERATIONS: ReadonlySet<OperationName> = new Set<OperationName>([
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "insertOne",
  "insertMany",
  "bulkWrite",
]);

export type { SortPair };
