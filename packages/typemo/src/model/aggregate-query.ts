import type { ClientSession, ReadConcernLevel, ReadPreferenceMode } from "mongodb";
import { BsonTypeTable, type PlainValue } from "../bson/bson-type-table.ts";
import { type QueryCursor, TypedCursor } from "../cursor/typed-cursor.ts";
import { EXPLAIN_VERBOSITY } from "../operation/executor/driver-executor.ts";
import type { AggregateExecutionPlan } from "../operation/pipeline/execution-plan.ts";
import { PolicyContext, type PolicyValues } from "../policies/policy-context.ts";
import { type ExecOptions, ExecutionOnce } from "../query/executable-query.ts";
import { ParsedQuery } from "../query/parsed-query.ts";
import type { PlanOptions } from "../query/plan.ts";
import { QuerySpecs } from "../query/query-specs.ts";
import { type ApplyMask, MaskedQuery, type MaskSpecCheck, ResponseMask } from "../query/response-mask.ts";
import type { AnyStandardSchema, StandardSchemaOutput } from "../schema/standard-schema/standard-schema.ts";
import type { ExpectRows } from "../types/contract.ts";
import type { ExplainResult, ExplainVerbosity } from "../types/result.ts";
import type { PipelineExecutor } from "./pipeline-executor.ts";

/*
 * `Model.aggregate(…)`: the plan of the pipeline builder run through the operation pipeline.
 * Immutable like the query builders. A read aggregation runs once per object (later awaits share the
 * result), one ending in `$out`/`$merge` is a write and runs once (a second await is an error).
 * `.plain()` gives the rows in their plain form. A row of an aggregation has no schema (its shape is the
 * pipeline's), so every value goes through the BSON type table alone: ids, int64, `Decimal128`, `UUID` →
 * strings, bytes → `Uint8Array`, a vector → `number[]`; a stored Map is a record in a row and stays one
 * (only a schema knows a Map).
 */

/**
 * Tells whether a pipeline stage writes to a collection.
 *
 * @param stage - The last stage of the pipeline, if any.
 * @returns `true` for `$out` and `$merge`.
 */
const isWriteStage = (stage: Readonly<Record<string, unknown>> | undefined): boolean =>
  stage !== undefined && ("$out" in stage || "$merge" in stage);

/** An aggregation of a model, typed by its rows. Immutable: every option returns a new query. */
export class AggregateQuery<Row> implements Promise<Row[]> {
  readonly #executor: PipelineExecutor;
  readonly #plan: AggregateExecutionPlan;
  readonly #once = new ExecutionOnce();
  /** The rows are converted to their plain form. */
  readonly #plain: boolean;

  /**
   * Not for direct use: call `Model.aggregate`.
   * @param executor - Runs the plan through the operation pipeline.
   * @param plan - The aggregation plan; frozen.
   * @param plain - Whether the rows are converted to their plain form.
   */
  constructor(executor: PipelineExecutor, plan: AggregateExecutionPlan, plain = false) {
    this.#executor = executor;
    this.#plan = Object.freeze(plan);
    this.#plain = plain;
  }

  /**
   * Runs the plan once more (the rows in the form of this aggregation).
   *
   * @returns The rows, plain when `.plain()` was applied.
   */
  #run(): Promise<unknown> {
    const rows = this.#executor.run(this.#plan);
    return this.#plain
      ? rows.then((value) => (value as readonly unknown[]).map((row) => BsonTypeTable.toPlain(row)))
      : rows;
  }

  /**
   * The EXECUTION plan of this aggregation: the same kind of value as `find().build()`, the pipeline-level plan
   * bound to this model (`entity`, the builder's options as `aggregateOptions`) plus this query's own options
   * (`session`, `timeoutMS`, `policy`, …). It is not the `AggregatePlan` that
   * `PipelineBuilder.plan()` returns, which holds only the source (`target`) and the stages and runs on any model
   * of that collection.
   *
   * @returns The frozen execution plan.
   */
  build(): AggregateExecutionPlan {
    return this.#plan;
  }

  /**
   * A copy of this query with the plan options merged over the current ones.
   *
   * @param options - The options to change.
   * @returns A new query.
   */
  #with(options: Partial<PlanOptions>): AggregateQuery<Row> {
    return new AggregateQuery<Row>(
      this.#executor,
      { ...this.#plan, options: Object.freeze({ ...this.#plan.options, ...options }) },
      this.#plain,
    );
  }

  /**
   * Runs in this session.
   *
   * @param session - The session; `null` runs outside the ambient transaction.
   * @returns A new query.
   */
  session(session: ClientSession | null): AggregateQuery<Row> {
    return this.#with({ session });
  }

  /**
   * The policy context of this aggregation (tenant, actor, soft delete view), over the ambient one.
   *
   * @param values - The policy values to apply.
   * @returns A new query.
   */
  policy(values: PolicyValues): AggregateQuery<Row> {
    return this.#with({ policy: PolicyContext.merge(this.#plan.options.policy, values, "aggregate.policy") });
  }

  /**
   * Client-side operation timeout (driver CSOT).
   *
   * @param ms - The timeout in milliseconds.
   * @returns A new query.
   */
  timeoutMS(ms: number): AggregateQuery<Row> {
    return this.#with({ timeoutMS: QuerySpecs.timeoutMS(ms) });
  }

  /**
   * A comment for the profiler and the logs.
   *
   * @param comment - The comment text.
   * @returns A new query.
   */
  comment(comment: string): AggregateQuery<Row> {
    return this.#with({ comment });
  }

  /**
   * Read preference.
   *
   * @param mode - The read preference mode.
   * @returns A new query.
   */
  readPreference(mode: ReadPreferenceMode): AggregateQuery<Row> {
    return this.#with({ readPreference: mode });
  }

  /**
   * Read concern. Inside a transaction the transaction's own concern applies, so setting one here is an error.
   *
   * @param level - The read concern level.
   * @returns A new query.
   */
  readConcern(level: ReadConcernLevel): AggregateQuery<Row> {
    return this.#with({ readConcern: level });
  }

  /**
   * Documents per cursor batch: a positive integer.
   *
   * @param n - The batch size.
   * @returns A new query.
   * @throws {QueryError} When `n` is not a positive integer (`0` would mean "the server default" to the driver).
   */
  batchSize(n: number): AggregateQuery<Row> {
    return this.#with({ batchSize: QuerySpecs.positive("batchSize", n) });
  }

  /**
   * The rows in their plain form (`PlainValue` of the row type): ids, int64, `Decimal128`, `UUID` as
   * strings, `Date`/`RegExp` kept, bytes as `Uint8Array`, a vector as `number[]`. A row has no schema: a stored Map
   * is a record and stays one. `parse`, `expect` and `cursor` follow.
   *
   * @returns A new query typed by the plain rows.
   */
  plain(): AggregateQuery<PlainValue<Row>> {
    /* Already plain: the same rows (a second conversion would meet its own `Uint8Array`s). */
    if (this.#plain) return this as AggregateQuery<unknown> as AggregateQuery<PlainValue<Row>>;
    return new AggregateQuery<PlainValue<Row>>(this.#executor, this.#plan, true);
  }

  /**
   * Runs the aggregation once per object: a read aggregation returns the cached rows again, one
   * with `$out`/`$merge` refuses a second run; `{ force: true }` runs it again.
   *
   * @param options - Execution options (`force`).
   * @returns The rows.
   */
  exec(options?: ExecOptions): Promise<Row[]> {
    const write = isWriteStage(this.#plan.pipeline.at(-1));
    /* `ExecutionOnce` memoizes reads by operation kind; an aggregation with `$out`/`$merge` is a write. */
    return this.#once.run(write ? "updateMany" : "find", () => this.#run(), options, "aggregate") as Promise<Row[]>;
  }

  /**
   * Makes the query awaitable; equal to `exec()`.
   *
   * @param onfulfilled - Called with the rows.
   * @param onrejected - Called with the error.
   * @returns A promise of the handlers' result.
   */
  // biome-ignore lint/suspicious/noThenProperty: a thenable query, awaited like a promise.
  then<R1 = Row[], R2 = never>(
    onfulfilled?: ((value: Row[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  /**
   * Attaches a rejection handler (runs the aggregation).
   *
   * @param onrejected - Called with the error.
   * @returns A promise of the rows or of the handler's value.
   */
  catch<R2 = never>(onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): Promise<Row[] | R2> {
    return this.exec().catch(onrejected);
  }

  /**
   * Attaches a completion handler (runs the aggregation).
   *
   * @param onfinally - Called when the promise settles.
   * @returns A promise of the rows.
   */
  finally(onfinally?: (() => void) | null): Promise<Row[]> {
    return this.exec().finally(onfinally);
  }

  /**
   * The tag `Object.prototype.toString` prints (`[object TypemoQuery]`). With `then`, `catch` and `finally` it
   * completes the `Promise` interface, so an aggregation can be returned where a `Promise` of its rows is expected.
   *
   * @returns `"TypemoQuery"`.
   */
  get [Symbol.toStringTag](): string {
    return "TypemoQuery";
  }

  /**
   * Streams the rows (the same pipeline as `await`).
   *
   * @returns A cursor of the rows.
   */
  cursor(): QueryCursor<Row> {
    const cursor = new TypedCursor<Row>(this.#executor.stream(this.#plan) as AsyncIterable<Row, void, undefined>);
    return this.#plain ? cursor.map((row) => BsonTypeTable.toPlain(row) as Row) : cursor;
  }

  /**
   * Validates every row by a Standard Schema (zod, valibot, arktype, a model's `~standard`): the rows
   * are the schema's output; any issue is a `ValidationError` whose path starts with the row's index. Async schemas
   * are awaited; `cursor()` of the parsed aggregation validates each row as it is read.
   *
   * @param schema - The Standard Schema each row must satisfy.
   * @returns A query of the parsed rows.
   * @throws {ValidationError} When a row does not satisfy the schema.
   */
  parse<Sch extends AnyStandardSchema>(
    schema: Sch,
  ): ParsedQuery<StandardSchemaOutput<Sch>[], StandardSchemaOutput<Sch>, true> {
    const write = isWriteStage(this.#plan.pipeline.at(-1));
    return new ParsedQuery(
      {
        op: write ? "updateMany" : "find",
        method: "aggregate",
        run: () => this.#run(),
        cursor: () => this.cursor() as QueryCursor<unknown>,
      },
      schema,
      true,
    );
  }

  /**
   * The exact contract check of the rows, types only, no runtime cost: this same aggregation when a
   * row is EXACTLY `Shape`, otherwise a compile error that names what is `missing`, `extra` or a `mismatch`.
   *
   * @returns This aggregation.
   */
  expect<Shape>(this: AggregateQuery<Row> & ExpectRows<Row, Shape>): AggregateQuery<Row> {
    return this;
  }

  /**
   * Masks the rows for the caller: keys are typed paths of the FINAL row of the pipeline, values
   * `"mask"` (→ `"?"`) or a mask function (`Mask.*`). There is no `"sensitive"` preset: only the listed paths are
   * masked; hiding a field is `project`/`select`.
   * Hooks, events and audit see the real rows; `cursor()` of the masked aggregation masks each row as it is read.
   *
   * @param spec - Typed paths of the final row mapped to `"mask"` or a mask function.
   * @returns A query of the masked rows.
   */
  mask<const Sp extends object>(
    spec: Sp & MaskSpecCheck<Row, Sp>,
  ): MaskedQuery<ApplyMask<Row, Sp>[], ApplyMask<Row, Sp>, true> {
    const tree = ResponseMask.compile(spec);
    const write = isWriteStage(this.#plan.pipeline.at(-1));
    return new MaskedQuery(
      {
        op: write ? "updateMany" : "find",
        method: "aggregate",
        model: this.#plan.entity.name,
        run: () => this.#run(),
        cursor: () => this.cursor() as QueryCursor<unknown>,
        checkRows: true,
      },
      tree,
    );
  }

  /**
   * The server's plan of the aggregation.
   *
   * @param verbosity - How detailed the plan is.
   * @returns The explain result.
   * @throws {QueryError} When `verbosity` is not one of the three levels.
   */
  explain(verbosity: ExplainVerbosity = "queryPlanner"): Promise<ExplainResult> {
    return this.#executor.run(
      this.#plan,
      "explain",
      new Map([[EXPLAIN_VERBOSITY, QuerySpecs.explainVerbosity(verbosity)]]),
    ) as Promise<ExplainResult>;
  }
}
