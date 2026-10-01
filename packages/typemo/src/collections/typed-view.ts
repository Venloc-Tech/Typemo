import type { CollationOptions, Db } from "mongodb";
import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { PipelineBuilder, type StagedPipeline } from "../aggregate/pipeline/pipeline-builder.ts";
import { type DocOf, PipelineSources, type SourceInput } from "../aggregate/pipeline/pipeline-source.ts";
import type { ViewRowCheck } from "../aggregate/pipeline/view-types.ts";
import type { Connection } from "../connection/connection.ts";
import { ConnectionInternals } from "../connection/connection-internals.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { ErrorTranslator } from "../errors/error-translator.ts";
import type { AggregateQuery } from "../model/aggregate-query.ts";
import type { AggregateBuild, AggregateResult, AggregateRows, Model, ModelAggregateOptions } from "../model/model.ts";
import { ModelIndexes } from "../model/model-indexes.ts";
import { ModelInternals } from "../model/model-internals.ts";
import { DbNames } from "../operation/steps/db-names.ts";
import { HiddenPolicy } from "../policies/hidden-policy.ts";
import type { CountQuery } from "../query/count-query.ts";
import type { DistinctValue } from "../query/model-operations.ts";
import type { OptionQuery } from "../query/option-query.ts";
import type { QueryBuilder } from "../query/query-builder.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import type { Filter, FilterPaths } from "../types/filter.ts";
import type { NoNarrowing } from "../types/narrow.ts";
import type { FilterCheck } from "../types/path-check.ts";
import { type CollectionDifference, CollectionOptionsError } from "./collection-errors.ts";
import { CollectionGuard } from "./collection-guard.ts";
import { CollectionManager, type EnsureCollectionOptions, type EnsureCollectionReport } from "./collection-manager.ts";

/*
 * A MongoDB view as a typed, read-only model. The view class is written like an entity
 * (`@Schema({ collection: "<view name>" })`, its fields are what a row looks like, `_id` declared like any
 * model); the pipeline is checked against it by `ViewRowCheck` (the rows must provide every field with a
 * compatible type; `$out`/`$merge` are not in the view builder). The object has only reads (`find`,
 * `findOne`, `countDocuments`, `distinct`, `aggregate`), all LEAN: a view cannot be written, so a
 * hydrated, savable document would promise what the server refuses. Nothing is created until `ensure()`
 * (or `connection.init()`); the first read checks that the view exists — the server reads a missing view as an
 * empty collection, so a view that was never created is a `ConfigurationError`, not `[]`.
 *
 * The stored pipeline is what the server runs on every read, so it gets what the operation pipeline gives
 * an aggregation: the source's `Hidden` fields removed first (also inside `$lookup`/`$unionWith`), a
 * discriminator source's `$match`. A source (or joined model) with `dbName` aliases is refused: the stored
 * pipeline would name code paths.
 */

/**
 * The definition of a view as the server keeps it.
 *
 * @example
 * ```ts
 * declare const activeUsers: TypedView<{ name: string }>;
 * const info: ViewInfo = activeUsers.definition;
 * info.viewOn; // "users"
 * ```
 */
export interface ViewInfo {
  /** The view's name (its collection name). */
  readonly name: string;
  /** The collection (or view) it reads. */
  readonly viewOn: string;
  /** The stored pipeline, with hidden-field and discriminator stages already applied. */
  readonly pipeline: readonly PipelineStage[];
  /** The view's default collation. */
  readonly collation?: CollationOptions;
}

/**
 * What `TypedView.define` takes.
 *
 * @typeParam Src - The source entity (or view) the pipeline reads.
 * @typeParam R - The pipeline result type.
 *
 * @example
 * ```ts
 * const definition: TypedViewDefinition<typeof User, StagedPipeline> = {
 *   on: User,
 *   pipeline: (p) => p.match({ active: true }),
 * };
 * ```
 */
export interface TypedViewDefinition<Src extends SourceInput, R> {
  /** The entity whose collection the view reads (same database). */
  readonly on: Src;
  /** The pipeline over the source's documents; its rows must fit the view class. */
  readonly pipeline: (p: PipelineBuilder<DocOf<Src>, "view", "empty">) => R;
  /** The default collation of the view (a view on a view must use the source's). */
  readonly collation?: CollationOptions;
}

/**
 * A frozen plain object as returned by the server.
 *
 * @example
 * ```ts
 * const stored: Plain = { viewOn: "users", pipeline: [] };
 * ```
 */
type Plain = Readonly<Record<string, unknown>>;

/** The views defined per connection, by view name. */
const VIEWS = new WeakMap<Connection, Map<string, TypedView<object>>>();

/**
 * Serializes a value with object keys sorted, so equal definitions compare equal regardless of key order.
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
 * A read-only typed model of a MongoDB view.
 *
 * @typeParam V - The view class instance type (a row).
 *
 * @example
 * ```ts
 * @Schema({ collection: "active_users" })
 * class ActiveUser extends Entity {
 *   @Prop(() => String, { required: true }) name!: string;
 * }
 * const activeUsers = TypedView.define(connection, ActiveUser, {
 *   on: User,
 *   pipeline: (p) => p.match({ active: true }).project({ name: 1 }),
 * });
 * await activeUsers.ensure();
 * const rows = await activeUsers.find({});
 * ```
 */
export class TypedView<V extends object> {
  /** The name, source, stored pipeline and collation. */
  readonly definition: ViewInfo;
  /** The view class. */
  readonly entity: EntityClass<V>;
  readonly #model: Model<V>;
  readonly #connection: Connection;

  /**
   * @param connection - The connection the view belongs to.
   * @param model - The model of the view class.
   * @param definition - The frozen definition.
   */
  private constructor(connection: Connection, model: Model<V>, definition: ViewInfo) {
    this.#connection = connection;
    this.#model = model;
    this.entity = model.entity;
    this.definition = definition;
  }

  /**
   * Defines the view of class `View` on `connection` (nothing is created until `ensure()`). The pipeline
   * result must fit the class (`ViewRowCheck`: a compile error names the fields that do not).
   *
   * @typeParam View - The view entity class.
   * @typeParam Src - The source entity or view.
   * @typeParam R - The staged pipeline the callback returns.
   * @param connection - The connection that owns the view.
   * @param view - The view class.
   * @param definition - The source, the pipeline and an optional collation.
   * @returns The typed view.
   * @throws {ConfigurationError} When the view reads itself, its source uses `dbName` aliases, the pipeline
   * contains `$out`/`$merge`, or the name is already defined with another definition.
   */
  static define<View extends abstract new () => object, const Src extends SourceInput, R extends StagedPipeline>(
    connection: Connection,
    view: View,
    definition: TypedViewDefinition<Src, R> & {
      readonly pipeline: (
        p: PipelineBuilder<DocOf<Src>, "view", "empty">,
      ) => R & ViewRowCheck<R extends PipelineBuilder<infer Row, "view", "staged"> ? Row : never, InstanceType<View>>;
    },
  ): TypedView<InstanceType<View>> {
    const model = connection.model(view as unknown as EntityClass<InstanceType<View>>);
    const name = model.collectionName;
    /* The source entity compiles with this connection's extensions. */
    return PipelineSources.within(ConnectionInternals.compileContext(connection), () => {
      const viewOn = PipelineSources.collectionOf(definition.on);
      if (viewOn === name) throw new ConfigurationError(`view "${name}" cannot read from itself`);
      const source = PipelineSources.schemaOf(definition.on);
      if (source !== undefined && DbNames.hasAliases(source.root))
        throw new ConfigurationError(
          `view "${name}": the source ${source.name} stores fields under dbName aliases; a stored view pipeline cannot be translated`,
        );
      const stages = definition.pipeline(new PipelineBuilder(undefined, [], {})).build();
      TypedView.assertNoWrite(stages, name);
      const discriminator = source?.discriminator;
      const prefix: PipelineStage[] =
        discriminator === undefined ? [] : [Object.freeze({ $match: { [discriminator.key]: discriminator.value } })];
      const pipeline = HiddenPolicy.stages([...prefix, ...stages], source, [], (collection) =>
        ConnectionInternals.environment(connection).schemaOfCollection(collection),
      );
      const info: ViewInfo = Object.freeze({
        name,
        viewOn,
        pipeline: Object.freeze([...pipeline]),
        ...(definition.collation === undefined ? {} : { collation: Object.freeze({ ...definition.collation }) }),
      });
      const typed = new TypedView(connection, model, info);
      let views = VIEWS.get(connection);
      if (views === undefined) {
        views = new Map();
        VIEWS.set(connection, views);
      }
      const existing = views.get(name);
      if (existing !== undefined && canonical(existing.definition) !== canonical(info))
        throw new ConfigurationError(`view "${name}" is already defined on this connection with another definition`);
      views.set(name, typed as unknown as TypedView<object>);
      /* The first operation checks that the view exists (a missing view reads as empty on the server). */
      CollectionGuard.watchView(ModelInternals.schema(model));
      return typed;
    });
  }

  /**
   * The views defined on a connection.
   *
   * @param connection - The connection to look up.
   * @returns The views, in definition order.
   */
  static of(connection: Connection): readonly TypedView<object>[] {
    return [...(VIEWS.get(connection)?.values() ?? [])];
  }

  /**
   * `true` when `collection` is a view defined on `connection` (its model has no collection or indexes).
   *
   * @param connection - The connection to look up.
   * @param collection - The collection name.
   * @returns Whether the name belongs to a defined view.
   */
  static isView(connection: Connection, collection: string): boolean {
    return VIEWS.get(connection)?.has(collection) === true;
  }

  /**
   * A view cannot write: `$out`/`$merge` anywhere (also in `$lookup`/`$facet`/`$unionWith`) is an error.
   *
   * @param value - A pipeline, stage or nested value to scan.
   * @param name - The view name, for the message.
   * @throws {ConfigurationError} When `$out` or `$merge` is found.
   */
  private static assertNoWrite(value: unknown, name: string): void {
    if (Array.isArray(value)) {
      for (const item of value) TypedView.assertNoWrite(item, name);
      return;
    }
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === "$out" || key === "$merge")
        throw new ConfigurationError(`view "${name}": a view pipeline cannot contain ${key}`);
      TypedView.assertNoWrite(inner, name);
    }
  }

  /**
   * Rows matching `filter` (plain objects).
   *
   * @typeParam F - The filter type.
   * @param filter - The filter; all rows when omitted.
   * @returns A lean `find` query.
   */
  find<F extends Filter<V, true>>(
    filter?: F & NoInfer<FilterCheck<V, F>>,
  ): QueryBuilder<V, "find", undefined, never, true, false, NoNarrowing, never> {
    return this.#model.find(filter as never).lean();
  }

  /**
   * The first row matching `filter`, or `null`.
   *
   * @typeParam F - The filter type.
   * @param filter - The filter; any row when omitted.
   * @returns A lean `findOne` query.
   */
  findOne<F extends Filter<V, true>>(
    filter?: F & NoInfer<FilterCheck<V, F>>,
  ): QueryBuilder<V, "findOne", undefined, never, true, false, NoNarrowing, never> {
    return this.#model.findOne(filter as never).lean();
  }

  /**
   * The number of matching rows.
   *
   * @typeParam F - The filter type.
   * @param filter - The filter; all rows when omitted.
   * @returns A count query.
   */
  countDocuments<F extends Filter<V, true>>(filter?: F & NoInfer<FilterCheck<V, F>>): CountQuery {
    return this.#model.countDocuments(filter as never);
  }

  /**
   * The distinct values at `path`.
   *
   * @typeParam P - The field path.
   * @typeParam F - The filter type.
   * @param path - The field to collect values of.
   * @param filter - Restricts the rows considered.
   * @returns A query resolving to the distinct values.
   */
  distinct<const P extends FilterPaths<V>, F extends Filter<V, true>>(
    path: P,
    filter?: F & NoInfer<FilterCheck<V, F>>,
  ): OptionQuery<DistinctValue<V, P>[]> {
    /* Called untyped: passing the generic path through the model's generic signature is TS2589 (the
       path union of a generic `V` is instantiated); the signature above is the same as the model's. */
    const distinct = this.#model.distinct as unknown as (
      path: string,
      filter?: unknown,
    ) => OptionQuery<DistinctValue<V, P>[]>;
    return distinct.call(this.#model, path, filter);
  }

  /**
   * An aggregation over the view's rows.
   *
   * @typeParam B - The aggregation result shape.
   * @param build - Builds the pipeline from the view's row type.
   * @param options - Aggregate options.
   * @returns An aggregate query.
   */
  aggregate<B extends AggregateResult>(
    build: AggregateBuild<V, B>,
    options?: ModelAggregateOptions,
  ): AggregateQuery<AggregateRows<B>> {
    return this.#model.aggregate(build, options);
  }

  /**
   * The driver database of the connection.
   *
   * @returns The `Db` the view lives in.
   */
  #db(): Db {
    return ConnectionInternals.environment(this.#connection).driver.db;
  }

  /**
   * The differences between this definition and the stored one.
   *
   * @param stored - The `options` of the server's `listCollections` entry.
   * @returns The differing options; empty when the view matches.
   */
  private differences(stored: Plain): CollectionDifference[] {
    const out: CollectionDifference[] = [];
    if (stored.viewOn !== this.definition.viewOn)
      out.push({ option: "viewOn", mutable: true, wanted: this.definition.viewOn, actual: stored.viewOn });
    if (canonical(stored.pipeline ?? []) !== canonical(this.definition.pipeline))
      out.push({ option: "pipeline", mutable: true, wanted: this.definition.pipeline, actual: stored.pipeline });
    if (!ModelIndexes.sameCollation(this.definition.collation, stored.collation as Plain | undefined))
      out.push({ option: "collation", mutable: false, wanted: this.definition.collation, actual: stored.collation });
    return out;
  }

  /**
   * Makes the view exist with this definition: created when missing, `"unchanged"` when it matches,
   * `"updated"` with `update: true` (`collMod` of `viewOn` and `pipeline`). A different collation cannot be
   * changed, and a regular collection under the view's name is never touched: `CollectionOptionsError`.
   *
   * @param options - `update` applies a changed pipeline or source; `dryRun` only reports.
   * @returns What was (or, with `dryRun`, would be) done, with the differences found.
   * @throws {CollectionOptionsError} When the name is a regular collection, the collation differs, or the
   * definition differs and `update` is not set.
   */
  async ensure(options: EnsureCollectionOptions = {}): Promise<EnsureCollectionReport> {
    const report = await this.#ensure(options);
    /* The view exists now: its reads need no check. */
    if (options.dryRun !== true) CollectionGuard.viewFound(ModelInternals.schema(this.#model), true);
    return report;
  }

  /**
   * The work of {@link ensure}.
   *
   * @param options - `update` and `dryRun`.
   * @returns What was (or would be) done.
   * @throws {CollectionOptionsError} As `ensure`.
   */
  async #ensure(options: EnsureCollectionOptions): Promise<EnsureCollectionReport> {
    await this.#connection.ready();
    const { name, viewOn, pipeline, collation } = this.definition;
    const info = await CollectionManager.info(this.#db(), name);
    if (info === undefined) {
      if (options.dryRun === true) return Object.freeze({ result: "created", differences: Object.freeze([]) });
      try {
        await this.#db().createCollection(name, {
          viewOn,
          pipeline: [...pipeline] as never,
          ...(collation === undefined ? {} : { collation }),
        });
        return Object.freeze({ result: "created", differences: Object.freeze([]) });
      } catch (error) {
        if (ErrorTranslator.codeOf(error) !== 48) throw ErrorTranslator.wrap(error);
        return this.#ensure(options);
      }
    }
    if (info.type !== "view")
      throw new CollectionOptionsError(
        name,
        `exists as a ${info.type ?? "collection"}, not a view: drop it or rename the view`,
      );
    const differences = Object.freeze(this.differences(info.options ?? {}));
    if (differences.length === 0) return Object.freeze({ result: "unchanged", differences });
    if (differences.some((difference) => !difference.mutable))
      throw new CollectionOptionsError(
        name,
        "the view exists with another collation, which MongoDB cannot change: drop it and run ensure() again",
        differences,
      );
    if (options.dryRun === true) return Object.freeze({ result: "updated", differences });
    if (options.update !== true)
      throw new CollectionOptionsError(
        name,
        "the view exists with another definition (source or pipeline): run ensure({ update: true }) to change it",
        differences,
      );
    try {
      await this.#db().command({ collMod: name, viewOn, pipeline: [...pipeline] });
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
    return Object.freeze({ result: "updated", differences });
  }

  /**
   * Drops the view (never a regular collection); `false` when it did not exist. The next read checks again
   * that the view exists.
   *
   * @returns `true` when the view was dropped.
   * @throws {CollectionOptionsError} When the name is a regular collection.
   */
  async drop(): Promise<boolean> {
    await this.#connection.ready();
    CollectionGuard.viewFound(ModelInternals.schema(this.#model), false);
    const info = await CollectionManager.info(this.#db(), this.definition.name);
    if (info === undefined) return false;
    if (info.type !== "view")
      throw new CollectionOptionsError(
        this.definition.name,
        `is a ${info.type ?? "collection"}, not a view: drop() only drops views`,
      );
    try {
      return await this.#db().dropCollection(this.definition.name);
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
  }
}
