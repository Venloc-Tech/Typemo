import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { Pipeline } from "../aggregate/pipeline/pipeline.ts";
import type { PipelineBuilder, StagedPipeline, TerminalPipeline } from "../aggregate/pipeline/pipeline-builder.ts";
import { type DocOf, PipelineSources } from "../aggregate/pipeline/pipeline-source.ts";
import type { MergeWhenMatched, MergeWhenNotMatched } from "../aggregate/pipeline/stage-specs.ts";
import type { TargetRowCheck } from "../aggregate/pipeline/view-types.ts";
import type { Connection } from "../connection/connection.ts";
import { ConnectionInternals } from "../connection/connection-internals.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import type { Model, ModelAggregateOptions } from "../model/model.ts";
import { ModelInternals } from "../model/model-internals.ts";
import { DriverExecutor } from "../operation/executor/driver-executor.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import type { DataKeys } from "../types/schema-paths.ts";
import { TypedView } from "./typed-view.ts";

/*
 * A stored result of a pipeline: a regular collection of an entity class, filled by an aggregation over
 * the source that ends with `$merge` (default) or `$out` (`mode: "replace"`), refreshed by `refresh()`.
 * Unlike a view it is read from disk, can have indexes, and its model is an ordinary `Model`. The
 * pipeline's rows are checked against the target class like a view's (`TargetRowCheck`); the aggregation
 * runs through the source model's operation pipeline (hidden fields, dbName translation, discriminator,
 * hooks), so it is the same as `aggregate`.
 * A `$merge` on fields other than `_id` needs a unique index on exactly them: checked on the server
 * first, with a clear error (MongoDB: "Cannot find index to verify that join fields will be unique").
 */

/**
 * How the rows are written to the target collection.
 *
 * @typeParam Target - The target entity class instance type; `on` accepts only its data keys.
 *
 * @example
 * ```ts
 * interface Stats {
 *   day: string;
 *   total: number;
 * }
 * const merge: MaterializedWrite<Stats> = { mode: "merge", on: "day", whenMatched: "replace" };
 * const replace: MaterializedWrite<Stats> = { mode: "replace" };
 * ```
 */
export type MaterializedWrite<Target> =
  | {
      /** `$merge` (default): rows are inserted or merged by `on`; the collection is never emptied. */
      readonly mode?: "merge";
      /** The field(s) that identify a row (default `_id`); others need a unique index on exactly them. */
      readonly on?: DataKeys<Target> | "_id" | readonly [DataKeys<Target> | "_id", ...(DataKeys<Target> | "_id")[]];
      /** What `$merge` does with a row that already exists in the target. */
      readonly whenMatched?: MergeWhenMatched;
      /** What `$merge` does with a row that does not exist in the target yet. */
      readonly whenNotMatched?: MergeWhenNotMatched;
    }
  | {
      /** `$out`: the collection is replaced by the rows (its indexes are kept). */
      readonly mode: "replace";
    };

/**
 * What a materialized result is defined as.
 *
 * @example
 * ```ts
 * declare const totals: Materialized<{ total: number }>;
 * const info: MaterializedInfo = totals.definition;
 * info.into; // the target collection name
 * ```
 */
export interface MaterializedInfo {
  /** The source collection name. */
  readonly from: string;
  /** The target collection name. */
  readonly into: string;
  /** `merge` writes with `$merge`, `replace` with `$out`. */
  readonly mode: "merge" | "replace";
  /** The `$merge` keys (empty for `replace`). */
  readonly on: readonly string[];
  /** The computing stages (without the `$merge`/`$out` added by `refresh`). */
  readonly pipeline: readonly PipelineStage[];
}

/**
 * The rows of a materialized result against the target class: like a view (`TargetRowCheck`), except that a
 * row may leave `_id` out — `$merge` and `$out` give an inserted row one (a row that has `_id` is checked
 * with it).
 *
 * @typeParam Row - The row type the pipeline produces.
 * @typeParam V - The target class instance type the rows are checked against.
 *
 * @example
 * ```ts
 * interface Stats {
 *   _id: string;
 *   total: number;
 * }
 * type Check = MaterializedRowCheck<{ _id: string; total: number }, Stats>; // unknown: the rows fit
 * ```
 */
export type MaterializedRowCheck<Row, V> = [Row] extends [never]
  ? TargetRowCheck<Row, V>
  : "_id" extends keyof Row
    ? TargetRowCheck<Row, V>
    : TargetRowCheck<Row, Omit<V, "_id">>;

/**
 * The pipeline callback with its row types erased, as stored by a materialized result.
 *
 * @example
 * ```ts
 * const build: AnyBuild = (p) => p.match({});
 * ```
 */
type AnyBuild = (p: PipelineBuilder<unknown, "collection", "empty">) => StagedPipeline;

/**
 * A collection of `T` computed from a pipeline and refreshed on demand.
 *
 * @typeParam T - The target entity instance type.
 *
 * @example
 * ```ts
 * @Schema({ collection: "customer_totals" })
 * class CustomerTotal {
 *   @Prop(() => Types.ObjectId) _id?: Types.ObjectId;
 *   @Prop(() => Number, { required: true }) total!: number;
 * }
 * const totals = Materialized.define(connection, CustomerTotal, {
 *   from: Order,
 *   pipeline: (p) => p.group((f) => ({ _id: f.customerId, total: fn.sum(f.amount) })),
 * });
 * await totals.refresh();
 * ```
 */
export class Materialized<T extends object> {
  /** The ordinary model of the target collection. */
  readonly model: Model<T>;
  /** What the result is defined as: source, target, write mode, `$merge` keys and computing stages. */
  readonly definition: MaterializedInfo;
  readonly #source: Model<object>;
  readonly #build: AnyBuild;
  readonly #write: { readonly whenMatched?: MergeWhenMatched; readonly whenNotMatched?: MergeWhenNotMatched };

  /**
   * @param model - The model of the target collection.
   * @param source - The model the pipeline runs over.
   * @param definition - The frozen definition exposed as `definition`.
   * @param build - The user's pipeline callback.
   * @param write - The `$merge` `whenMatched`/`whenNotMatched` settings.
   */
  private constructor(
    model: Model<T>,
    source: Model<object>,
    definition: MaterializedInfo,
    build: AnyBuild,
    write: { readonly whenMatched?: MergeWhenMatched; readonly whenNotMatched?: MergeWhenNotMatched },
  ) {
    this.model = model;
    this.#source = source;
    this.definition = definition;
    this.#build = build;
    this.#write = write;
  }

  /**
   * Defines the materialized result of class `Target` on `connection`, computed from the entity `from`.
   * The pipeline does not end with `$merge`/`$out` (added by `refresh`); its rows must fit the class.
   *
   * @typeParam Target - The target entity class.
   * @typeParam Src - The source entity class.
   * @typeParam R - The staged pipeline the callback returns.
   * @param connection - The connection that owns both models.
   * @param target - The entity class of the target collection.
   * @param definition - The source class, the pipeline callback and the write settings.
   * @returns The materialized result; nothing is written until `refresh()`.
   * @throws {ConfigurationError} When the target collection is a view, or a `$merge` key is not a field of the class.
   */
  static define<Target extends abstract new () => object, const Src extends EntityClass, R extends StagedPipeline>(
    connection: Connection,
    target: Target,
    definition: {
      readonly from: Src;
      readonly pipeline: (
        p: PipelineBuilder<DocOf<Src>, "collection", "empty">,
      ) => R &
        MaterializedRowCheck<
          R extends PipelineBuilder<infer Row, "collection", "staged"> ? Row : never,
          InstanceType<Target>
        >;
    } & MaterializedWrite<InstanceType<Target>>,
  ): Materialized<InstanceType<Target>> {
    const model = connection.model(target as unknown as EntityClass<InstanceType<Target>>);
    if (TypedView.isView(connection, model.collectionName))
      throw new ConfigurationError(
        `${target.name}: a materialized result is a regular collection; "${model.collectionName}" is a view`,
      );
    const source = connection.model(definition.from as EntityClass<object>);
    const mode = definition.mode ?? "merge";
    const write = definition as {
      readonly on?: string | readonly string[];
      readonly whenMatched?: MergeWhenMatched;
      readonly whenNotMatched?: MergeWhenNotMatched;
    };
    const on = mode === "merge" ? Object.freeze([write.on ?? "_id"].flat().map(String)) : Object.freeze([]);
    for (const key of on) {
      if (key !== "_id" && ModelInternals.schema(model).field(key) === undefined)
        throw new ConfigurationError(`${target.name}: $merge on "${key}", which is not a field of the class`);
    }
    const build = definition.pipeline as unknown as AnyBuild;
    const stages = PipelineSources.within(ConnectionInternals.compileContext(model.connection), () =>
      build(Pipeline.from(definition.from) as never).build(),
    );
    return new Materialized(
      model,
      source,
      Object.freeze({
        from: source.collectionName,
        into: model.collectionName,
        mode,
        on,
        pipeline: Object.freeze([...stages]),
      }),
      build,
      Object.freeze({
        ...(write.whenMatched === undefined ? {} : { whenMatched: write.whenMatched }),
        ...(write.whenNotMatched === undefined ? {} : { whenNotMatched: write.whenNotMatched }),
      }),
    );
  }

  /**
   * Computes the rows and writes them (`$merge` or `$out`). Nothing refreshes by itself. A `$merge` on
   * fields other than `_id` checks the unique index on the server first.
   *
   * @param options - Aggregate options passed to the source model's aggregation.
   * @returns Resolves when the server has written the rows.
   * @throws {ConfigurationError} When `$merge` keys other than `_id` have no unique index in the target.
   */
  async refresh(options?: ModelAggregateOptions): Promise<void> {
    const { mode, on } = this.definition;
    if (mode === "merge" && on.some((key) => key !== "_id")) await this.assertUniqueIndex();
    const into = this.model.entity;
    const query = this.#source.aggregate((p) => {
      const builder = this.#build(p as never) as unknown as {
        out(target: unknown): TerminalPipeline;
        merge(spec: Readonly<Record<string, unknown>>): TerminalPipeline;
      };
      return mode === "replace"
        ? builder.out(into)
        : builder.merge({ into, on: on.length === 1 ? on[0] : on, ...this.#write });
    }, options);
    await query;
  }

  /**
   * `$merge` on `on` needs a unique index on exactly those fields in the target collection.
   *
   * @returns Resolves when such an index exists.
   * @throws {ConfigurationError} When no unique index covers exactly the `$merge` keys.
   */
  private async assertUniqueIndex(): Promise<void> {
    await this.model.connection.ready();
    const wanted = [...this.definition.on]
      .map((key) => this.model.schema.toDbPath(key) ?? key)
      .sort()
      .join(",");
    const indexes = await DriverExecutor.listIndexes(
      ConnectionInternals.environment(this.model.connection).driver.db.collection(this.definition.into),
    );
    const found = indexes.some((index) => index.unique === true && Object.keys(index.key).sort().join(",") === wanted);
    if (!found) {
      throw new ConfigurationError(
        `${this.model.modelName}: $merge on ${this.definition.on.map((key) => `"${key}"`).join(", ")} needs a unique index on exactly these fields in "${this.definition.into}"; declare it (@Index(..., { unique: true })) and run syncIndexes(), or merge on _id`,
      );
    }
  }
}
