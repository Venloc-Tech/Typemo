import type { CollationOptions } from "mongodb";
import type { DocPaths } from "../types/path-types.ts";
import type { PipelineTarget } from "./pipeline-source.ts";

/*
 * The immutable result of a pipeline builder ("builder → operation plan"). The operation pipeline executes it
 * (resolve the context → … → execute through the driver); this layer only builds it. `Row` is phantom: the type
 * of each result document.
 */

/** Type-level key of the phantom row type of a plan. */
declare const ROW: unique symbol;

/**
 * One serialized stage (`{ $match: … }`). Frozen.
 *
 * @example
 * ```ts
 * const stage: PipelineStage = { $match: { active: true } };
 * ```
 */
export type PipelineStage = Readonly<Record<string, unknown>>;

/**
 * Index key values of a hint.
 *
 * @example
 * ```ts
 * const values: IndexKeyValue[] = [1, -1, "text", "2dsphere"];
 * ```
 */
export type IndexKeyValue = 1 | -1 | "text" | "2dsphere" | "2d" | "hashed";

/**
 * A `hint`: an index name, or the key spec of an index over the paths of the source document. The paths
 * are checked by type; `Pipeline.from` checks at run time that such an index is declared by the schema.
 *
 * @typeParam Root - The source document type.
 * @example
 * ```ts
 * const byName: IndexHint<User> = "email_1";
 * const bySpec: IndexHint<User> = { email: 1 };
 * ```
 */
export type IndexHint<Root> = string | { readonly [P in DocPaths<Root> | "_id"]?: IndexKeyValue };

/**
 * Options of an aggregation that belong to the plan (execution options such as `session` or `timeoutMS` belong
 * to the operation that runs it).
 *
 * @typeParam Root - The source document type.
 * @example
 * ```ts
 * const options: AggregateOptions<User> = { allowDiskUse: true, hint: { email: 1 } };
 * ```
 */
export interface AggregateOptions<Root> {
  /** The index to use: a name or a key spec. */
  readonly hint?: IndexHint<Root>;
  /** The collation of the aggregation. */
  readonly collation?: CollationOptions;
  /** Whether stages may write temporary files to disk. */
  readonly allowDiskUse?: boolean;
  /** A comment attached to the command, visible in server logs and profiler. */
  readonly comment?: string;
  /** The number of documents per batch of the cursor. */
  readonly batchSize?: number;
  /** Whether to skip document validation for `$out` / `$merge` writes. */
  readonly bypassDocumentValidation?: boolean;
  /** `Hidden` paths of the source included in the rows (the other `Hidden` fields are removed by a leading `$unset`). */
  readonly include?: readonly string[];
}

/**
 * The plan of one aggregation, as the pipeline builder makes it (`PipelineBuilder.plan()`): the source (`target`),
 * the stages and the options of the pipeline. It knows no model and no execution option, so it runs on any model of
 * that collection. `Model.aggregate(...).build()` returns another value, the `AggregateExecutionPlan`: this plan
 * bound to a model plus the query's own options.
 *
 * @typeParam Row - The type of each result document.
 * @example
 * ```ts
 * const plan: AggregatePlan<{ _id: string | null; total: number }> = Pipeline.from(Order)
 *   .group((f) => ({ _id: f.status, total: fn.sum(f.amount) }))
 *   .plan();
 * plan.op; // "aggregate"
 * ```
 */
export interface AggregatePlan<Row> {
  /** Phantom: the row type. */
  readonly [ROW]?: readonly [Row];
  /** The operation kind. */
  readonly op: "aggregate";
  /** Where the documents come from. */
  readonly target: PipelineTarget;
  /** The serialized stages. */
  readonly pipeline: readonly PipelineStage[];
  /** The options of the aggregation. */
  readonly options: AggregateOptions<unknown>;
}

/**
 * The row type of a plan.
 *
 * @typeParam P - The plan type.
 * @example
 * ```ts
 * type Row = PlanRow<AggregatePlan<{ total: number }>>; // { total: number }
 * ```
 */
export type PlanRow<P> = P extends AggregatePlan<infer R> ? R : never;
