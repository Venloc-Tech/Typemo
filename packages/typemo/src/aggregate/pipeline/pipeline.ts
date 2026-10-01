import type { ChangeStreamDocument } from "mongodb";
import type { AggregateOptions, PipelineStage } from "./aggregate-plan.ts";
import { PipelineBuilder, type StagedPipeline } from "./pipeline-builder.ts";
import { type DocOf, type HiddenOf, PipelineSources, type SourceInput, type StoredDocOf } from "./pipeline-source.ts";
import type { AnyDocument } from "./stage-specs.ts";
import type { ViewPipelineCheck } from "./view-types.ts";

/* Entry points of the pipeline builder. `Model.aggregate()` is built on top of `Pipeline.from`. */

/**
 * A view definition checked against the view class; the collection layer creates the view from it.
 *
 * @example
 * ```ts
 * const definition: ViewDefinition = { viewOn: "users", pipeline: [{ $match: { active: true } }] };
 * ```
 */
export interface ViewDefinition {
  /** The collection (or view) the view reads. */
  readonly viewOn: string;
  /** The stages of the view. */
  readonly pipeline: readonly PipelineStage[];
}

/** Entry points of the pipeline builder. */
export class Pipeline {
  /**
   * A collection aggregation over an entity (or a model). `options.hint` is checked against the
   * schema's declared indexes. The rows start as the stored documents WITHOUT the `Hidden` fields;
   * `options.include` names hidden paths to keep (like `+field` of `find`).
   *
   * @typeParam Src - The entity class or typed source.
   * @typeParam Inc - The hidden paths to include.
   * @param source - The entity class or model the pipeline reads from.
   * @param options - The aggregation options.
   * @returns An empty builder over the stored documents of the source.
   * @throws {ConfigurationError} When `options.hint` matches no index declared by the schema.
   * @example
   * ```ts
   * const pipeline = Pipeline.from(Order).match({ status: "paid" }).plan();
   * ```
   */
  static from<const Src extends SourceInput, const Inc extends HiddenOf<Src> = never>(
    source: Src,
    options: AggregateOptions<DocOf<Src>> & { readonly include?: readonly Inc[] } = {},
  ): PipelineBuilder<DocOf<Src, Inc>, "collection", "empty"> {
    const target = PipelineSources.targetOf(source);
    const schema = PipelineSources.schemaOf(source);
    if (options.hint !== undefined && schema !== undefined) PipelineSources.assertHint(schema, options.hint);
    return new PipelineBuilder(target, [], Object.freeze({ ...options }));
  }

  /**
   * A database aggregation (`$documents`, `$changeStream`, `$listLocalSessions`, `$listClusterCatalog`).
   * Its plan runs with `connection.aggregate(plan)` (that connection's database) or `client.aggregate(plan)`
   * (the client's default database).
   *
   * @param options - The aggregation options.
   * @returns An empty builder that is not bound to a collection.
   * @example
   * ```ts
   * const rows = await connection.aggregate(Pipeline.database().documents([{ n: 1 }, { n: 2 }]).plan());
   * ```
   */
  static database(options: AggregateOptions<never> = {}): PipelineBuilder<never, "database", "empty"> {
    return new PipelineBuilder({ kind: "database", admin: false }, [], Object.freeze({ ...options }));
  }

  /**
   * An aggregation of the `admin` database (`$currentOp`, `$queryStats`, `$querySettings`, …). Its plan
   * runs with `client.aggregate(plan)` or `connection.aggregate(plan)` (always on `admin`).
   *
   * @param options - The aggregation options.
   * @returns An empty builder bound to the `admin` database.
   * @example
   * ```ts
   * const running = await client.aggregate(Pipeline.admin().currentOp({ idleSessions: false }).plan());
   * ```
   */
  static admin(options: AggregateOptions<never> = {}): PipelineBuilder<never, "admin", "empty"> {
    return new PipelineBuilder({ kind: "database", admin: true }, [], Object.freeze({ ...options }));
  }

  /**
   * An aggregation of the collection `config.system.sessions`, the only place the server accepts
   * `$listSessions` (its only first stage). Its plan runs with `client.aggregate(plan)` or
   * `connection.aggregate(plan)` (always on `config.system.sessions`).
   *
   * @param options - The aggregation options.
   * @returns An empty builder bound to `config.system.sessions`.
   * @example
   * ```ts
   * const sessions = await client.aggregate(Pipeline.sessions().listSessions({ allUsers: true }).plan());
   * ```
   */
  static sessions(options: AggregateOptions<never> = {}): PipelineBuilder<never, "sessions", "empty"> {
    return new PipelineBuilder({ kind: "sessions" }, [], Object.freeze({ ...options }));
  }

  /**
   * An update pipeline over an entity (`updateOne(filter, pipeline)`): only `$addFields`,
   * `$set`, `$project`, `$unset`, `$replaceRoot`, `$replaceWith`.
   *
   * @typeParam Src - The entity class or typed source.
   * @param _source - The entity whose stored document the pipeline updates; used only for its type.
   * @returns An empty builder in update mode.
   */
  static update<const Src extends SourceInput>(_source: Src): PipelineBuilder<StoredDocOf<Src>, "update", "empty"> {
    return new PipelineBuilder(undefined, [], {});
  }

  /**
   * A change stream pipeline over an entity's collection (the change stream layer opens the stream): the rows
   * are the driver's change events; only `$match`, `$project`, `$addFields`, `$set`, `$unset`, `$replaceRoot`,
   * `$replaceWith`, `$redact` and a final `$changeStreamSplitLargeEvent`.
   *
   * @typeParam Src - The entity class or typed source.
   * @param source - The entity whose collection is watched.
   * @returns An empty builder in watch mode.
   */
  static watch<const Src extends SourceInput>(
    source: Src,
  ): PipelineBuilder<
    ChangeStreamDocument<StoredDocOf<Src> extends AnyDocument ? StoredDocOf<Src> : StoredDocOf<Src> & AnyDocument>,
    "watch",
    "empty"
  > {
    return new PipelineBuilder(PipelineSources.targetOf(source), [], {});
  }

  /**
   * A view definition: the pipeline reads `on` and its rows must fit the view class `View`
   * (`ViewPipelineCheck`); a view pipeline cannot hold `$out`/`$merge` (the builder has no such methods in view
   * mode). The collection layer creates the view (`create` with `viewOn` + `pipeline`).
   *
   * @typeParam View - The view class.
   * @typeParam Src - The entity class or typed source the view reads.
   * @typeParam R - The staged pipeline built by the callback.
   * @param _view - The view class; used only for its type.
   * @param definition - The source and the callback that builds the pipeline.
   * @returns The frozen view definition.
   */
  static view<View extends abstract new () => object, const Src extends SourceInput, R extends StagedPipeline>(
    _view: View,
    definition: {
      readonly on: Src;
      readonly pipeline: (p: PipelineBuilder<DocOf<Src>, "view", "empty">) => ViewPipelineCheck<R, InstanceType<View>>;
    },
  ): ViewDefinition {
    /* The check type is `PathError` only for a pipeline the caller is refused at compile time: at run time it is `R`. */
    const built = definition.pipeline(new PipelineBuilder(undefined, [], {})) as R;
    return Object.freeze({ viewOn: PipelineSources.collectionOf(definition.on), pipeline: built.build() });
  }
}
