import type { ChangeStreamDocument } from "mongodb";
import { CastError } from "../../errors/cast-error.ts";
import { ConfigurationError } from "../../errors/configuration-error.ts";
import { SafeRecord } from "../../internal/safe-record.ts";
import type { Lean } from "../../types/document-forms.ts";
import type { Filter } from "../../types/filter.ts";
import { ExprCompiler, type ExprOver } from "../expressions/expr-compiler.ts";
import { type ExprNode, ExprNodes } from "../expressions/expr-node.ts";
import type { Arg, Exact, Simplify, UnwrapDeep } from "../expressions/expr-types.ts";
import { FieldProxies, type FieldProxy, type VarProxy } from "../expressions/field-proxy.ts";
import { type SortDirectionInput, SortSpecs } from "../expressions/sort-spec.ts";
import type { RedactVerdict } from "../expressions/vars.ts";
import type { ArrayPaths, DocPaths, InvalidPathKeys, PathAt, PathError } from "../types/path-types.ts";
import type { AggregateOptions, AggregatePlan, PipelineStage } from "./aggregate-plan.ts";
import {
  type DocOf,
  PipelineSources,
  type PipelineTarget,
  type SourceInput,
  type StoredDocOf,
} from "./pipeline-source.ts";
import type {
  AnyDocument,
  ChangeStreamStageSpec,
  ClusterCatalogRow,
  ClusterCatalogSpec,
  CollStatsRow,
  CollStatsSpec,
  CurrentOpRow,
  CurrentOpSpec,
  DensifyRange,
  GeoPointInput,
  IndexStatsRow,
  ListSessionsSpec,
  MergeWhenMatched,
  MergeWhenNotMatched,
  NamedCollection,
  OutCollection,
  PlanCacheStatsRow,
  PlanCacheStatsSpec,
  QuerySettingsRow,
  QueryStatsRow,
  QueryStatsSpec,
  SampledQueryRow,
  ScoreNormalization,
  SearchIndexRow,
  SearchMetaRow,
  SearchSpec,
  SessionRow,
  ShardedDataDistributionRow,
  SplitEventFields,
  VectorSearchSpec,
} from "./stage-specs.ts";
import type {
  AccumulatorCheck,
  ApplyBucket,
  ApplyBucketAuto,
  ApplyDensify,
  ApplyFields,
  ApplyFill,
  ApplyGeoNear,
  ApplyGroup,
  ApplyLookup,
  ApplyProject,
  ApplyUnset,
  ApplyUnwind,
  ExprValues,
  GroupId,
  MixedProjection,
  ProjectNumbers,
  WindowCheck,
  WithDepth,
} from "./stage-types.ts";
import type { RowFits } from "./view-types.ts";

/*
 * The fluent, immutable pipeline builder. Every stage returns a NEW builder with the document type after that
 * stage. Nothing runs here: `plan()` gives the immutable `AggregatePlan<Row>` that the operation pipeline executes.
 *
 * Where a stage may be used is checked by two phantom parameters and `this` types:
 * - `M` — the context: a collection or database aggregation, an aggregation of `config.system.sessions`
 *   (`sessions`), a `$facet` branch, a `$lookup`/`$unionWith` sub-pipeline, a view definition, an update
 *   pipeline, a change stream pipeline (`watch`);
 * - `S` — `"empty"` until the first stage. First-stage-only stages (`$geoNear`, `$search`, `$collStats`,
 *   `$documents`, `$changeStream`, …) need `"empty"`; `plan()` needs `"staged"` (an empty pipeline does
 *   not run).
 * `$out`/`$merge` return a `TerminalPipeline`, which has no stage methods at all.
 */

/**
 * Where a builder is used.
 *
 * @example
 * ```ts
 * const mode: PipelineMode = "facet";
 * ```
 */
export type PipelineMode =
  | "collection"
  | "database"
  | "admin"
  | "sessions"
  | "facet"
  | "subpipeline"
  | "view"
  | "update"
  | "watch";

/**
 * Whether a builder has a stage yet.
 *
 * @example
 * ```ts
 * const state: PipelineState = "empty";
 * ```
 */
export type PipelineState = "empty" | "staged";

/**
 * Modes of the ordinary stages (`$group`, `$sort`, `$lookup`, …): not update or change-stream pipelines.
 *
 * @example
 * ```ts
 * const mode: GeneralMode = "view";
 * ```
 */
export type GeneralMode = "collection" | "database" | "admin" | "sessions" | "facet" | "subpipeline" | "view";
/**
 * Modes that may filter (`$match`, `$redact`): everything but update pipelines.
 *
 * @example
 * ```ts
 * const mode: FilterMode = "watch";
 * ```
 */
export type FilterMode = Exclude<PipelineMode, "update">;
/**
 * Modes whose pipelines write (`$out`, `$merge`): top-level aggregations only (not the aggregation of
 * `config.system.sessions`, which only reads).
 *
 * @example
 * ```ts
 * const mode: TopMode = "collection";
 * ```
 */
export type TopMode = "collection" | "database" | "admin";
/**
 * Modes that may hold a `$facet` (not a branch of one).
 *
 * @example
 * ```ts
 * const mode: FacetHostMode = "collection";
 * ```
 */
export type FacetHostMode = Exclude<GeneralMode, "facet">;

/**
 * The row type of a builder (or of a terminal pipeline: `never`).
 *
 * @typeParam B - The builder type.
 * @example
 * ```ts
 * type Row = RowOf<PipelineBuilder<{ total: number }, "collection", "staged">>; // { total: number }
 * ```
 */
export type RowOf<B> = B extends PipelineBuilder<infer U, PipelineMode, PipelineState> ? U : never;

/**
 * A builder that has at least one stage, in any mode (what sub-pipeline callbacks return).
 *
 * @example
 * ```ts
 * const sub = (p: PipelineBuilder<Order, "subpipeline", "empty">): StagedPipeline => p.limit(5);
 * ```
 */
export interface StagedPipeline {
  /**
   * `true` once the builder has a stage: a sub-pipeline callback must return one (an empty `$facet` branch or
   * `$lookup` pipeline is an error).
   */
  readonly hasStages: true;
  /** The number of stages. */
  readonly stageCount: number;
  /**
   * The serialized stages.
   *
   * @returns The stages, frozen.
   */
  build(): readonly PipelineStage[];
}

/**
 * A sort by the text or search score (`{ score: { $meta: "textScore" } }`).
 *
 * @example
 * ```ts
 * const sort: MetaSort = { $meta: "textScore" };
 * ```
 */
export interface MetaSort {
  /** The metadata to sort by. */
  readonly $meta: "textScore" | "searchScore";
}

/**
 * The object form of a stage `sortBy` over the current document (`$setWindowFields`, `$fill`).
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * const sortBy: SortStageSpec<{ at: Date }> = { at: 1 };
 * ```
 */
export type SortStageSpec<T> = { readonly [P in DocPaths<T>]?: SortDirectionInput };

/**
 * `$sort`: a path of the document with `1`/`-1` or a word (`"asc"`/`"desc"`), or a score, or a NEW key with a
 * `{ $meta }` score only; any other key is an error that names it.
 *
 * @typeParam T - The document type.
 * @typeParam S - The sort spec.
 * @example
 * ```ts
 * type Ok = SortCheck<{ a: number }, { a: -1; score: { $meta: "textScore" } }>; // unchanged
 * type Bad = SortCheck<{ a: number }, { b: 1 }>; // { b: PathError<…> }
 * ```
 */
export type SortCheck<T, S> = {
  [K in keyof S]: K extends DocPaths<T>
    ? SortDirectionInput | MetaSort
    : S[K] extends MetaSort
      ? MetaSort
      : PathError<`$sort: "${K & string}" is not a path of the document (only a { $meta } score may name a new key)`>;
};

/**
 * `$match` with a filter object: the strict `Filter<T>` (`$expr` there is `ExprFor<T>`). Invariant like `Filter`:
 * without the annotation the variance of this alias was measured structurally through the emitted
 * `.d.ts` (the whole filter grammar, TS2589 for every consumer of the built package).
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * const filter: MatchFilter<{ age: number }> = { age: { $gt: 18 } };
 * ```
 */
export type MatchFilter<in out T> = Filter<T>;

/**
 * A declared `Filter<E>` of an entity fits a `$match` whose rows still have the stored shape of `E`
 * (`Lean<E>`, or its visible part). `Filter` is invariant (declared, to keep the compiler from measuring
 * it), so `Filter<User>` is not `Filter<Lean<User>>`; the rows are compared instead, which is cheap.
 *
 * @typeParam E - The entity the filter was declared for.
 * @typeParam T - The current row type.
 * @example
 * ```ts
 * type Ok = EntityMatchCheck<User, Lean<User>>; // unknown
 * type Bad = EntityMatchCheck<User, { total: number }>; // PathError<"$match: the filter is of an entity …">
 * ```
 */
export type EntityMatchCheck<E, T> = [T] extends [Lean<E>]
  ? unknown
  : PathError<"$match: the filter is of an entity whose stored shape the rows no longer have (type the filter by the row)">;

/**
 * Proxies of `let` variables (`$lookup.let`, `$merge.let`).
 *
 * @typeParam V - The `let` values by variable name.
 * @example
 * ```ts
 * type P = VarsOf<{ total: ExprNode<number> }>; // { readonly total: VarProxy<number> }
 * ```
 */
export type VarsOf<V> = { readonly [K in keyof V]: VarProxy<UnwrapDeep<V[K]>> };

/**
 * The variables of a `$merge.whenMatched` pipeline: `let`'s, or `$$new` (the incoming row) by default.
 *
 * @typeParam T - The row type.
 * @typeParam V - The `let` values by variable name.
 * @example
 * ```ts
 * type A = MergeVars<{ n: number }, {}>; // { readonly new: VarProxy<{ n: number }> }
 * ```
 */
export type MergeVars<T, V> = [keyof V] extends [never] ? { readonly new: VarProxy<T> } : VarsOf<V>;

/**
 * `$unwind`'s object form.
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * const spec: UnwindSpec<{ tags: string[] }> = { path: "$tags", includeArrayIndex: "i" };
 * ```
 */
export interface UnwindSpec<T> {
  /** The array field, with a `$` prefix. */
  readonly path: `$${ArrayPaths<T>}`;
  /** The name of the field that receives the array index. */
  readonly includeArrayIndex?: string;
  /** Whether documents with a missing, null or empty array are kept. */
  readonly preserveNullAndEmptyArrays?: boolean;
}

/**
 * `$bucketAuto` granularity (a preferred number series; numeric `groupBy` only).
 *
 * @example
 * ```ts
 * const granularity: BucketGranularity = "R20";
 * ```
 */
export type BucketGranularity =
  | "R5"
  | "R10"
  | "R20"
  | "R40"
  | "R80"
  | "1-2-5"
  | "E6"
  | "E12"
  | "E24"
  | "E48"
  | "E96"
  | "E192"
  | "POWERSOF2";

/**
 * A `$bucket` boundary for a `groupBy` of value type `V`.
 *
 * @typeParam V - The type of the `groupBy` expression.
 * @example
 * ```ts
 * type A = Boundary<ExprNode<number | undefined>>; // number
 * ```
 */
type Boundary<V> = Exclude<UnwrapDeep<V>, null | undefined>;

/**
 * An output value of `$fill`.
 *
 * @typeParam T - The document type.
 * @example
 * ```ts
 * const a: FillEntry<{ v: number }> = { value: () => 0 };
 * const b: FillEntry<{ v: number }> = { method: "locf" };
 * ```
 */
type FillEntry<T> = { readonly value: (f: FieldProxy<T>) => Arg<unknown> } | { readonly method: "linear" | "locf" };

/**
 * Field names: no `$` prefix, no dot (`$count`, `$unwind.includeArrayIndex`, `let` variables).
 *
 * @typeParam N - The name.
 * @example
 * ```ts
 * type A = PlainName<"total">; // "total"
 * type B = PlainName<"$total">; // PathError<"a field name here cannot be empty, …">
 * ```
 */
type PlainName<N extends string> = N extends `$${string}` | `${string}.${string}` | ""
  ? PathError<"a field name here cannot be empty, start with $ or contain a dot">
  : N;

/**
 * A sub-pipeline callback in an implementation signature. The overloads type the builder it receives
 * precisely; the implementation only calls it (a typed builder parameter would make every overload
 * incompatible with the implementation: the builder is invariant in its document type).
 *
 * @example
 * ```ts
 * const build: AnySubPipeline = (p: PipelineBuilder<Order, "subpipeline", "empty">) => p.limit(1);
 * ```
 */
type AnySubPipeline = (...args: never[]) => StagedPipeline;

/**
 * Calls a sub-pipeline callback with a fresh source-less builder (and the `let` variables).
 *
 * @param build - The sub-pipeline callback.
 * @param vars - The `let` variable proxies passed as the second argument.
 * @returns The staged pipeline the callback returned.
 */
const callSub = (build: AnySubPipeline, vars: Record<string, unknown>): StagedPipeline =>
  (build as (p: PipelineBuilder<unknown, PipelineMode, "empty">, v: Record<string, unknown>) => StagedPipeline)(
    new PipelineBuilder<unknown, PipelineMode, "empty">(undefined, [], {}),
    vars,
  );

/** Window functions the server allows only with a `sortBy` of exactly ONE field (checked on 8.3 and 9.0). */
const SINGLE_SORT_KEY = ["$rank", "$denseRank", "$documentNumber", "$linearFill"] as const;

/**
 * Freezes one serialized stage.
 *
 * @param stage - The stage.
 * @returns The same object, frozen.
 */
const freezeStage = (stage: Record<string, unknown>): PipelineStage => Object.freeze(stage);

/**
 * Checks that a stage argument is an integer of at least `min`.
 *
 * @param name - The argument description, used in the error message.
 * @param n - The value.
 * @param min - The smallest allowed value.
 * @throws {ConfigurationError} When `n` is not an integer or is smaller than `min`.
 */
const assertInteger = (name: string, n: number, min: number): void => {
  if (!Number.isInteger(n) || n < min) {
    throw new ConfigurationError(`${name} takes an integer ≥ ${min}, got ${CastError.describe(n)}`);
  }
};

/**
 * Checks that a field name is not empty, does not start with `$` and has no dot.
 *
 * @param what - The stage or option description, used in the error message.
 * @param name - The name.
 * @throws {ConfigurationError} When the name is not a plain field name.
 */
const assertPlainName = (what: string, name: string): void => {
  if (name === "" || name.startsWith("$") || name.includes(".")) {
    throw new ConfigurationError(`${what}: "${name}" cannot be empty, start with $ or contain a dot`);
  }
};

/**
 * Checks that a `let` variable name starts with a lowercase letter and holds only letters, digits and `_`.
 *
 * @param name - The variable name.
 * @throws {ConfigurationError} When the name is not a valid variable name.
 */
const assertVariableName = (name: string): void => {
  if (!/^[a-z][A-Za-z0-9_]*$/.test(name)) {
    throw new ConfigurationError(
      `variable "${name}" must start with a lowercase letter and hold only letters, digits and _`,
    );
  }
};

/**
 * Whether the target of `$out`/`$merge` is a target object ({ db, coll }) rather than an entity class or a typed
 * source (a class is a function, a typed source carries `pipelineTarget`).
 *
 * @param target - The target as given.
 * @returns `true` for a plain object.
 */
const isTargetObject = (target: unknown): target is Readonly<Record<string, unknown>> =>
  typeof target === "object" && target !== null && !("pipelineTarget" in target);

/**
 * Checks the object form of a `$out`/`$merge` target: a typed caller cannot omit a required field, an untyped one
 * would otherwise get the server's refusal (or an entity-class error).
 *
 * @param stage - The stage name, for the message.
 * @param target - The target object.
 * @param needDb - Whether `db` is required (`$out`: yes; `$merge`: the aggregation's own database when omitted).
 * @throws {ConfigurationError} When `coll` (or a required `db`) is missing or not a non-empty string.
 */
const assertTargetObject = (stage: string, target: Readonly<Record<string, unknown>>, needDb: boolean): void => {
  const bad = (field: string): boolean => typeof target[field] !== "string" || target[field] === "";
  if (bad("coll") || (needDb && bad("db")) || (!needDb && target.db !== undefined && bad("db"))) {
    throw new ConfigurationError(
      `${stage}: a target object needs ${needDb ? 'both "db" and "coll"' : '"coll" (and "db" when given)'} as non-empty strings (got ${Object.keys(target).join(", ") || "an empty object"}); to write into an entity, pass the class`,
    );
  }
};

/**
 * Builds the variables of a `let` callback: the serialized `let` and the proxies for the sub-pipeline.
 *
 * @typeParam T - The document type the callback reads.
 * @typeParam V - The type of the returned variables.
 * @param build - The `let` callback, or `undefined` when there are no variables.
 * @returns The serialized `let` spec (`undefined` without a callback) and the variable proxies.
 * @throws {ConfigurationError} When a variable name is invalid.
 */
const letVariables = <T, V>(
  build: ((f: FieldProxy<T>) => V) | undefined,
): { readonly spec: Record<string, unknown> | undefined; readonly proxies: Record<string, unknown> } => {
  if (build === undefined) return { spec: undefined, proxies: {} };
  const values = build(FieldProxies.root<T>()) as Record<string, unknown>;
  const spec: Record<string, unknown> = {};
  const proxies: Record<string, unknown> = {};
  for (const name of Object.keys(values)) {
    assertVariableName(name);
    spec[name] = ExprNodes.serialize(values[name]);
    proxies[name] = FieldProxies.variable(name);
  }
  return { spec, proxies };
};

/**
 * Serializes every value of a record returned by a stage callback.
 *
 * @param record - The record.
 * @returns A new record with serialized values.
 */
const serializeRecord = (record: object): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) SafeRecord.set(out, key, ExprNodes.serialize(value));
  return out;
};

/** A pipeline ending in `$out`/`$merge`: no more stages; it returns no documents. */
export class TerminalPipeline {
  readonly #target: PipelineTarget | undefined;
  readonly #stages: readonly PipelineStage[];
  readonly #options: AggregateOptions<unknown>;

  /**
   * @param target - Where the documents come from, or `undefined` for a pipeline without a source.
   * @param stages - The serialized stages.
   * @param options - The aggregation options.
   */
  constructor(
    target: PipelineTarget | undefined,
    stages: readonly PipelineStage[],
    options: AggregateOptions<unknown>,
  ) {
    this.#target = target;
    this.#stages = Object.freeze([...stages]);
    this.#options = options;
  }

  /**
   * The stages, frozen.
   *
   * @returns The serialized stages.
   */
  build(): readonly PipelineStage[] {
    return this.#stages;
  }

  /**
   * The plan (rows: none).
   *
   * @returns The frozen aggregation plan.
   * @throws {ConfigurationError} When the pipeline has no source to run on.
   */
  plan(): AggregatePlan<never> {
    if (this.#target === undefined) throw new ConfigurationError("this pipeline has no source to run on");
    return Object.freeze({ op: "aggregate", target: this.#target, pipeline: this.#stages, options: this.#options });
  }
}

/** A change stream pipeline ending in `$changeStreamSplitLargeEvent`: no more stages. */
export class SealedPipeline<Row> {
  declare protected readonly row: Row;
  readonly #stages: readonly PipelineStage[];

  /**
   * @param stages - The serialized stages.
   */
  constructor(stages: readonly PipelineStage[]) {
    this.#stages = Object.freeze([...stages]);
  }

  /**
   * The stages, frozen.
   *
   * @returns The serialized stages.
   */
  build(): readonly PipelineStage[] {
    return this.#stages;
  }
}

/**
 * The pipeline builder. `T` is the document type at this point; `M` where the builder is used; `S`
 * whether it has a stage. Created by `Pipeline.from(Entity)` and friends, never directly.
 *
 * @typeParam T - The document type at this point of the pipeline.
 * @typeParam M - Where the builder is used.
 * @typeParam S - Whether the builder has a stage yet.
 * @example
 * ```ts
 * const plan = Pipeline.from(Order)
 *   .match({ status: "paid" })
 *   .group((f) => ({ _id: f.customerId, total: fn.sum(f.amount) }))
 *   .plan();
 * ```
 */
export class PipelineBuilder<T, M extends PipelineMode = "collection", S extends PipelineState = "staged"> {
  /** Phantom: the mode, so `this` types can tell where the builder is used. */
  declare protected readonly mode: M;
  /** Phantom: the state, so `this` types can tell whether the builder has a stage. */
  declare protected readonly state: S;
  /** Phantom: the row type, so the builder is invariant in its document type. */
  declare protected readonly row: T;
  /** Phantom: `true` once the builder has a stage (see `StagedPipeline`). */
  declare readonly hasStages: S extends "staged" ? true : false;
  readonly #target: PipelineTarget | undefined;
  /**
   * The stages (a private copy, never changed). Frozen only when handed out (`build`, `plan`) —
   * freezing an array in JSC turns off its fast storage, and a builder chain made one frozen copy per stage.
   */
  readonly #stages: readonly PipelineStage[];
  /** The frozen copy of the stages, made when first handed out. */
  #frozen: readonly PipelineStage[] | undefined;
  readonly #options: AggregateOptions<unknown>;

  /**
   * Not for direct use: start with `Pipeline.from(...)` or another `Pipeline.*` entry.
   * @param target - Where the documents come from, or `undefined` for a pipeline without a source.
   * @param stages - The serialized stages so far.
   * @param options - The aggregation options.
   */
  constructor(
    target: PipelineTarget | undefined,
    stages: readonly PipelineStage[],
    options: AggregateOptions<unknown>,
  ) {
    this.#target = target;
    this.#stages = [...stages];
    this.#options = options;
  }

  /**
   * The stages, frozen (one frozen copy per builder, made when first handed out).
   *
   * @returns The frozen stages.
   */
  #handedOut(): readonly PipelineStage[] {
    this.#frozen ??= Object.freeze([...this.#stages]);
    return this.#frozen;
  }

  /**
   * Number of stages so far.
   *
   * @returns The number of stages.
   */
  get stageCount(): number {
    return this.#stages.length;
  }

  /**
   * A new builder with one more stage.
   *
   * @typeParam U - The document type after the stage.
   * @typeParam N - The mode of the new builder.
   * @param stage - The serialized stage.
   * @returns The new builder; this one is unchanged.
   */
  #next<U, N extends PipelineMode = M>(stage: Record<string, unknown>): PipelineBuilder<U, N, "staged"> {
    return new PipelineBuilder<U, N, "staged">(this.#target, [...this.#stages, freezeStage(stage)], this.#options);
  }

  /**
   * The field proxy of the current document.
   *
   * @returns The proxy whose properties are `"$path"` references.
   */
  #f(): FieldProxy<T> {
    return FieldProxies.root<T>();
  }

  /**
   * A fresh sub-pipeline builder (no source of its own: `$lookup`, `$unionWith`, `$facet`, `$merge`).
   *
   * @typeParam U - The document type of the sub-pipeline.
   * @typeParam N - The mode of the sub-pipeline.
   * @returns An empty builder.
   */
  static #sub<U, N extends PipelineMode>(): PipelineBuilder<U, N, "empty"> {
    return new PipelineBuilder<U, N, "empty">(undefined, [], {});
  }

  /**
   * The stages of a sub-pipeline returned by a callback (it must have one).
   *
   * @param builder - The pipeline the callback returned.
   * @param what - The stage description, used in the error message.
   * @returns The serialized stages.
   * @throws {ConfigurationError} When the pipeline has no stage.
   */
  static #stagesOf(builder: StagedPipeline, what: string): readonly PipelineStage[] {
    if (builder.stageCount === 0) throw new ConfigurationError(`${what}: the pipeline needs at least one stage`);
    return builder.build();
  }

  /* ---- filtering, ordering, paging ---- */

  /**
   * `$match` with a filter object.
   *
   * @param filter - The filter over the current document.
   * @returns A builder with the same rows.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/match/
   */
  match(this: PipelineBuilder<T, FilterMode, PipelineState>, filter: MatchFilter<T>): PipelineBuilder<T, M, "staged">;
  /**
   * `$match` with a boolean expression (`(f) => fn.gt(f.total, 100)`, sent as `$expr`).
   *
   * @param predicate - The callback that builds the condition from the field proxy.
   * @returns A builder with the same rows.
   */
  match(this: PipelineBuilder<T, FilterMode, PipelineState>, predicate: ExprOver<T>): PipelineBuilder<T, M, "staged">;
  /**
   * `$match` with a declared filter of the ENTITY (`const f: Filter<User>`) while the rows still have
   * the entity's stored shape (the first stages of `Model.aggregate` / `Pipeline.from`).
   *
   * @typeParam E - The entity the filter was declared for.
   * @param filter - The declared entity filter.
   * @returns A builder with the same rows.
   */
  match<E extends object>(
    this: PipelineBuilder<T, FilterMode, PipelineState>,
    filter: Filter<E> & NoInfer<EntityMatchCheck<E, T>>,
  ): PipelineBuilder<T, M, "staged">;
  match(
    this: PipelineBuilder<T, PipelineMode, PipelineState>,
    arg: Readonly<Record<string, unknown>> | ExprOver<T>,
  ): unknown {
    if (typeof arg === "function") return this.#next({ $match: { $expr: ExprCompiler.compileExpr(arg) } });
    return this.#next({ $match: ExprCompiler.resolveFilter(arg) });
  }

  /**
   * `$sort` by paths of the current document.
   *
   * @typeParam S - The sort spec.
   * @param spec - The paths with their directions (or `{ $meta }` scores).
   * @returns A builder with the same rows.
   * @throws {ConfigurationError} When the spec is empty or a direction is invalid.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sort/
   */
  sort<const S extends { readonly [key: string]: SortDirectionInput | MetaSort }>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: S & SortCheck<T, S>,
  ): PipelineBuilder<T, M, "staged"> {
    if (Object.keys(spec).length === 0) throw new ConfigurationError("$sort needs at least one key");
    return this.#next({ $sort: SortSpecs.normalize(spec, "$sort") });
  }

  /**
   * `$limit` (an integer ≥ 1).
   *
   * @param n - The maximum number of documents.
   * @returns A builder with the same rows.
   * @throws {ConfigurationError} When `n` is not an integer ≥ 1.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/limit/
   */
  limit(this: PipelineBuilder<T, GeneralMode, PipelineState>, n: number): PipelineBuilder<T, M, "staged"> {
    assertInteger("$limit", n, 1);
    return this.#next({ $limit: n });
  }

  /**
   * `$skip` (an integer ≥ 0).
   *
   * @param n - The number of documents to skip.
   * @returns A builder with the same rows.
   * @throws {ConfigurationError} When `n` is not an integer ≥ 0.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/skip/
   */
  skip(this: PipelineBuilder<T, GeneralMode, PipelineState>, n: number): PipelineBuilder<T, M, "staged"> {
    assertInteger("$skip", n, 0);
    return this.#next({ $skip: n });
  }

  /**
   * `$sample` of `size` random documents.
   *
   * @param size - The number of documents.
   * @returns A builder with the same rows.
   * @throws {ConfigurationError} When `size` is not an integer ≥ 1.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sample/
   */
  sample(this: PipelineBuilder<T, GeneralMode, PipelineState>, size: number): PipelineBuilder<T, M, "staged"> {
    assertInteger("$sample.size", size, 1);
    return this.#next({ $sample: { size } });
  }

  /**
   * `$count`: one row `{ [field]: n }` (no row for no input).
   *
   * @typeParam K - The name of the count field.
   * @param field - The name of the field that receives the count.
   * @returns A builder whose rows are `{ [field]: number }`.
   * @throws {ConfigurationError} When the name is empty, starts with `$` or contains a dot.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/count/
   */
  count<const K extends string>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    field: K & PlainName<K>,
  ): PipelineBuilder<{ [P in K]: number }, M, "staged"> {
    assertPlainName("$count", field);
    return this.#next({ $count: field });
  }

  /**
   * `$redact`: the callback returns `Vars.DESCEND`, `Vars.PRUNE` or `Vars.KEEP` (usually through `fn.cond`).
   *
   * @param builder - The callback that builds the verdict from the field proxy.
   * @returns A builder with the same rows.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/redact/
   */
  redact(
    this: PipelineBuilder<T, FilterMode, PipelineState>,
    builder: (f: FieldProxy<T>) => ExprNode<RedactVerdict>,
  ): PipelineBuilder<T, M, "staged"> {
    return this.#next({ $redact: ExprNodes.serialize(builder(this.#f())) });
  }

  /* ---- reshaping ---- */

  /**
   * `$addFields`: new or replaced fields (dotted keys write inside embedded documents; `fn.remove()`
   * removes).
   *
   * @typeParam F - The fields object the callback returns.
   * @param builder - The callback that builds the fields from the field proxy.
   * @returns A builder whose rows have the fields applied.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/addFields/
   */
  addFields<const F extends Record<string, unknown>>(
    builder: (f: FieldProxy<T>) => F & InvalidPathKeys<T, F> & ExprValues<F>,
  ): PipelineBuilder<ApplyFields<T, F>, M, "staged"> {
    return this.#next({ $addFields: serializeRecord(builder(this.#f())) });
  }

  /**
   * `$set`: the alias of `$addFields`.
   *
   * @typeParam F - The fields object the callback returns.
   * @param builder - The callback that builds the fields from the field proxy.
   * @returns A builder whose rows have the fields applied.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/set/
   */
  set<const F extends Record<string, unknown>>(
    builder: (f: FieldProxy<T>) => F & InvalidPathKeys<T, F> & ExprValues<F>,
  ): PipelineBuilder<ApplyFields<T, F>, M, "staged"> {
    return this.#next({ $set: serializeRecord(builder(this.#f())) });
  }

  /**
   * `$project` with computed fields: `1`/`true` keeps, `0`/`false` drops, a node computes.
   *
   * @typeParam P - The projection object the callback returns.
   * @param builder - The callback that builds the projection from the field proxy.
   * @returns A builder whose rows have the projection applied.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/project/
   */
  project<const P extends Record<string, unknown>>(
    builder: (f: FieldProxy<T>) => P & MixedProjection<P> & ProjectNumbers<P> & ExprValues<P>,
  ): PipelineBuilder<ApplyProject<T, P>, M, "staged">;
  /**
   * `$project` by paths: `{ "a.b": 1, c: 1 }` or `{ secret: 0 }` (never mixed, except `_id`).
   *
   * @typeParam P - The projection object.
   * @param spec - The paths with `0`, `1` or a boolean.
   * @returns A builder whose rows have the projection applied.
   * @throws {ConfigurationError} When the projection is empty.
   */
  project<const P extends { readonly [K in DocPaths<T> | "_id"]?: 0 | 1 | boolean }>(
    spec: P &
      Exact<P, { readonly [K in DocPaths<T> | "_id"]?: 0 | 1 | boolean }> &
      MixedProjection<P> /*
       * A callback matches this all-optional shape (P falls back to its constraint): without the guard a
       * callback refused by the overload above (an accumulator as a value) would compile here, unchecked. Every
       * function has `Symbol.hasInstance`, no projection object does.
       */ & { readonly [Symbol.hasInstance]?: never },
  ): PipelineBuilder<ApplyProject<T, P>, M, "staged">;
  project(arg: ((f: FieldProxy<T>) => Record<string, unknown>) | Record<string, unknown>): unknown {
    const spec = typeof arg === "function" ? arg(this.#f()) : arg;
    if (Object.keys(spec).length === 0) throw new ConfigurationError("$project needs at least one field");
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(spec)) {
      SafeRecord.set(
        out,
        key,
        value === 0 || value === 1 || typeof value === "boolean" ? value : ExprNodes.serialize(value),
      );
    }
    return this.#next({ $project: out });
  }

  /**
   * `$unset` of paths.
   *
   * @typeParam U - The path or the list of paths.
   * @param fields - The path or paths to remove.
   * @returns A builder whose rows lack those paths.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/unset/
   */
  unset<const U extends DocPaths<T> | readonly [DocPaths<T>, ...DocPaths<T>[]]>(
    fields: U,
  ): PipelineBuilder<ApplyUnset<T, U>, M, "staged"> {
    return this.#next({ $unset: typeof fields === "string" ? fields : [...(fields as readonly string[])] });
  }

  /**
   * `$replaceRoot`: the new root must be a document (the stage fails on `null`/missing, so the type has no
   * `null`).
   *
   * @typeParam R - The new root the callback returns.
   * @param builder - The callback that builds the new root from the field proxy.
   * @returns A builder whose rows are the new root.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/replaceRoot/
   */
  replaceRoot<const R extends Arg<{ readonly [key: string]: unknown }>>(
    builder: (f: FieldProxy<T>) => R,
  ): PipelineBuilder<Simplify<NonNullable<UnwrapDeep<R>>>, M, "staged"> {
    return this.#next({ $replaceRoot: { newRoot: ExprNodes.serialize(builder(this.#f())) } });
  }

  /**
   * `$replaceWith`: the shorthand of `$replaceRoot`.
   *
   * @typeParam R - The new root the callback returns.
   * @param builder - The callback that builds the new root from the field proxy.
   * @returns A builder whose rows are the new root.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/replaceWith/
   */
  replaceWith<const R extends Arg<{ readonly [key: string]: unknown }>>(
    builder: (f: FieldProxy<T>) => R,
  ): PipelineBuilder<Simplify<NonNullable<UnwrapDeep<R>>>, M, "staged"> {
    return this.#next({ $replaceWith: ExprNodes.serialize(builder(this.#f())) });
  }

  /**
   * `$unwind` of an array field (`"$items"`).
   *
   * @typeParam P - The `$path` of the array field.
   * @param path - The array field, with a `$` prefix.
   * @returns A builder whose rows hold one element instead of the array.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/unwind/
   */
  unwind<const P extends `$${ArrayPaths<T>}`>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    path: P,
  ): PipelineBuilder<ApplyUnwind<T, P>, M, "staged">;
  /**
   * `$unwind` with `includeArrayIndex` (an int64) and `preserveNullAndEmptyArrays`.
   *
   * @typeParam U - The options object.
   * @param spec - The path and the options.
   * @returns A builder whose rows hold one element instead of the array.
   * @throws {ConfigurationError} When `includeArrayIndex` is not a plain field name.
   */
  unwind<const U extends UnwindSpec<T>>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: U & Exact<U, UnwindSpec<T>>,
  ): PipelineBuilder<ApplyUnwind<T, U>, M, "staged">;
  unwind(this: PipelineBuilder<T, PipelineMode, PipelineState>, arg: string | UnwindSpec<T>): unknown {
    if (typeof arg === "object" && arg.includeArrayIndex !== undefined) {
      assertPlainName("$unwind.includeArrayIndex", arg.includeArrayIndex);
    }
    return this.#next({ $unwind: typeof arg === "string" ? arg : { ...arg } });
  }

  /* ---- grouping ---- */

  /**
   * `$group`: `_id` (an expression, `null` or a composite object) and accumulators — every other value
   * must be an accumulator.
   *
   * @typeParam G - The stage object the callback returns.
   * @param builder - The callback that builds `_id` and the accumulators from the field proxy.
   * @returns A builder whose rows are the groups.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/group/
   */
  group<const G extends { readonly _id: unknown }>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    builder: (f: FieldProxy<T>) => AccumulatorCheck<G, "$group">,
  ): PipelineBuilder<ApplyGroup<G>, M, "staged"> {
    return this.#next({ $group: serializeRecord(builder(this.#f())) });
  }

  /**
   * `$bucket`: `_id` is the lower boundary of the document's bucket, or `default`.
   *
   * @typeParam GB - The `groupBy` expression type.
   * @typeParam O - The `output` accumulators.
   * @typeParam D - The `default` bucket id type.
   * @param spec - The `groupBy` expression, the boundaries and the optional `default` and `output`.
   * @returns A builder whose rows are the buckets.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/bucket/
   */
  bucket<
    const GB extends Arg<unknown>,
    const O extends Record<string, unknown> = Record<never, never>,
    const D = never,
  >(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly groupBy: (f: FieldProxy<T>) => GB;
      readonly boundaries: readonly [NoInfer<Boundary<GB>>, NoInfer<Boundary<GB>>, ...NoInfer<Boundary<GB>>[]];
      readonly default?: D;
      readonly output?: (f: FieldProxy<T>) => AccumulatorCheck<O, "$bucket">;
    },
  ): PipelineBuilder<ApplyBucket<Boundary<GB>, O, D>, M, "staged"> {
    const f = this.#f();
    return this.#next({
      $bucket: {
        groupBy: ExprNodes.serialize(spec.groupBy(f)),
        boundaries: ExprNodes.serialize(spec.boundaries),
        ...(spec.default === undefined ? {} : { default: ExprNodes.serialize(spec.default) }),
        ...(spec.output === undefined ? {} : { output: serializeRecord(spec.output(f)) }),
      },
    });
  }

  /**
   * `$bucketAuto`: `buckets` evenly filled buckets, `_id: { min, max }`.
   *
   * @typeParam GB - The `groupBy` expression type.
   * @typeParam O - The `output` accumulators.
   * @param spec - The `groupBy` expression, the number of buckets and the optional granularity and `output`.
   * @returns A builder whose rows are the buckets.
   * @throws {ConfigurationError} When `buckets` is not an integer ≥ 1.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/bucketAuto/
   */
  bucketAuto<const GB extends Arg<unknown>, const O extends Record<string, unknown> = Record<never, never>>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly groupBy: (f: FieldProxy<T>) => GB;
      readonly buckets: number;
      readonly granularity?: BucketGranularity;
      readonly output?: (f: FieldProxy<T>) => AccumulatorCheck<O, "$bucketAuto">;
    },
  ): PipelineBuilder<ApplyBucketAuto<UnwrapDeep<GB>, O>, M, "staged"> {
    assertInteger("$bucketAuto.buckets", spec.buckets, 1);
    const f = this.#f();
    return this.#next({
      $bucketAuto: {
        groupBy: ExprNodes.serialize(spec.groupBy(f)),
        buckets: spec.buckets,
        ...(spec.granularity === undefined ? {} : { granularity: spec.granularity }),
        ...(spec.output === undefined ? {} : { output: serializeRecord(spec.output(f)) }),
      },
    });
  }

  /**
   * `$sortByCount`: `{ _id, count }` by descending count.
   *
   * @typeParam V - The type of the grouped expression.
   * @param builder - The callback that builds the expression to group by.
   * @returns A builder whose rows are `{ _id, count }`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sortByCount/
   */
  sortByCount<const V extends Arg<unknown>>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    builder: (f: FieldProxy<T>) => V,
  ): PipelineBuilder<{ _id: GroupId<V>; count: number }, M, "staged"> {
    return this.#next({ $sortByCount: ExprNodes.serialize(builder(this.#f())) });
  }

  /**
   * `$setWindowFields` with `sortBy`: every output is a window function or an accumulator; ordered
   * functions (`fn.rank()`, `fn.shift`, bounded windows) are allowed; `fn.rank()`, `fn.denseRank()`,
   * `fn.documentNumber()` and `fn.linearFill` need a `sortBy` with exactly one field.
   *
   * @typeParam O - The `output` object.
   * @typeParam S - The `sortBy` object.
   * @param spec - The optional partition, the sort and the output callback.
   * @returns A builder whose rows have the outputs applied.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/setWindowFields/
   */
  setWindowFields<const O extends Record<string, unknown>, const S extends SortStageSpec<T>>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly partitionBy?: (f: FieldProxy<T>) => Arg<unknown>;
      readonly sortBy: S & Exact<S, SortStageSpec<T>>;
      readonly output: (f: FieldProxy<T>) => O & WindowCheck<O, true, keyof S>;
    },
  ): PipelineBuilder<ApplyFields<T, O>, M, "staged">;
  /**
   * `$setWindowFields` without `sortBy`: ordered functions do not compile (they need `sortBy`).
   *
   * @typeParam O - The `output` object.
   * @param spec - The optional partition and the output callback.
   * @returns A builder whose rows have the outputs applied.
   */
  setWindowFields<const O extends Record<string, unknown>>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly partitionBy?: (f: FieldProxy<T>) => Arg<unknown>;
      readonly output: (f: FieldProxy<T>) => O & WindowCheck<O, false>;
    },
  ): PipelineBuilder<ApplyFields<T, O>, M, "staged">;
  setWindowFields(
    this: PipelineBuilder<T, PipelineMode, PipelineState>,
    spec: {
      readonly partitionBy?: (f: FieldProxy<T>) => unknown;
      readonly sortBy?: SortStageSpec<T>;
      readonly output: (f: FieldProxy<T>) => Record<string, unknown>;
    },
  ): unknown {
    const f = this.#f();
    const output = serializeRecord(spec.output(f));
    const single = Object.values(output).find(
      (value) => typeof value === "object" && value !== null && SINGLE_SORT_KEY.some((op) => op in value),
    );
    if (single !== undefined && Object.keys(spec.sortBy ?? {}).length !== 1) {
      throw new ConfigurationError(
        `$setWindowFields: ${Object.keys(single as object).join(", ")} needs a sortBy with exactly one field (server rule)`,
      );
    }
    return this.#next({
      $setWindowFields: {
        ...(spec.partitionBy === undefined ? {} : { partitionBy: ExprNodes.serialize(spec.partitionBy(f)) }),
        ...(spec.sortBy === undefined ? {} : { sortBy: SortSpecs.normalize(spec.sortBy, "sortBy") }),
        output,
      },
    });
  }

  /**
   * `$densify`: fills gaps of a number or date field (new documents have only that field and the
   * partition fields).
   *
   * @typeParam F - The densified field path.
   * @typeParam P - The partition field paths.
   * @param spec - The field, the optional partition fields and the range.
   * @returns A builder whose rows may be the generated documents (other fields optional).
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/densify/
   */
  densify<const F extends DocPaths<T>, const P extends DocPaths<T> = never>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly field: F;
      readonly partitionByFields?: readonly P[];
      readonly range: DensifyRange<PathAt<T, F>>;
    },
  ): PipelineBuilder<ApplyDensify<T, F, P>, M, "staged"> {
    return this.#next({ $densify: ExprNodes.serialize(spec) as Record<string, unknown> });
  }

  /**
   * `$fill` with `sortBy`: values by expression or by `method` (`"linear"`, `"locf"`).
   *
   * @typeParam O - The `output` entries by field path.
   * @param spec - The optional partition, the sort and the output entries.
   * @returns A builder whose rows have the filled fields.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/fill/
   */
  fill<const O extends { readonly [K in DocPaths<T>]?: FillEntry<T> }>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly partitionBy?: (f: FieldProxy<T>) => Arg<unknown>;
      readonly partitionByFields?: readonly DocPaths<T>[];
      readonly sortBy: SortStageSpec<T>;
      readonly output: O;
    },
  ): PipelineBuilder<ApplyFill<T, O>, M, "staged">;
  /**
   * `$fill` without `sortBy`: only `value` (a `method` needs `sortBy`).
   *
   * @typeParam O - The `output` entries by field path.
   * @param spec - The optional partition and the output entries.
   * @returns A builder whose rows have the filled fields.
   */
  fill<const O extends { readonly [K in DocPaths<T>]?: { readonly value: (f: FieldProxy<T>) => Arg<unknown> } }>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly partitionBy?: (f: FieldProxy<T>) => Arg<unknown>;
      readonly partitionByFields?: readonly DocPaths<T>[];
      readonly output: O;
    },
  ): PipelineBuilder<ApplyFill<T, O>, M, "staged">;
  fill(
    this: PipelineBuilder<T, PipelineMode, PipelineState>,
    spec: {
      readonly partitionBy?: (f: FieldProxy<T>) => unknown;
      readonly partitionByFields?: readonly string[];
      readonly sortBy?: SortStageSpec<T>;
      readonly output: Readonly<Record<string, FillEntry<T> | undefined>>;
    },
  ): unknown {
    const f = this.#f();
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(spec.output)) {
      if (entry === undefined) continue;
      output[key] = "value" in entry ? { value: ExprNodes.serialize(entry.value(f)) } : { method: entry.method };
    }
    return this.#next({
      $fill: {
        ...(spec.partitionBy === undefined ? {} : { partitionBy: ExprNodes.serialize(spec.partitionBy(f)) }),
        ...(spec.partitionByFields === undefined ? {} : { partitionByFields: [...spec.partitionByFields] }),
        ...(spec.sortBy === undefined ? {} : { sortBy: SortSpecs.normalize(spec.sortBy, "sortBy") }),
        output,
      },
    });
  }

  /* ---- joins ---- */

  /**
   * `$lookup` with a sub-pipeline over `from`; `let` variables are proxies in the pipeline callback
   * (`(p, v) => p.match((j) => fn.eq(j.authorId, v.uid))`).
   *
   * @typeParam Src - The entity class or typed source to join.
   * @typeParam As - The name of the result array field.
   * @typeParam R - The staged sub-pipeline.
   * @typeParam V - The `let` variables.
   * @param spec - The source, the result field, the optional fields and variables, and the pipeline callback.
   * @returns A builder whose rows hold the sub-pipeline rows in `as`.
   * @throws {ConfigurationError} When a variable name is invalid or the sub-pipeline has no stage.
   */
  lookup<
    Src extends SourceInput,
    const As extends string,
    R extends StagedPipeline,
    const V extends Record<string, unknown> = Record<never, never>,
  >(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly from: Src;
      readonly as: As;
      readonly localField?: DocPaths<T>;
      readonly foreignField?: DocPaths<DocOf<Src>>;
      readonly let?: (f: FieldProxy<T>) => V & ExprValues<V>;
      readonly pipeline: (p: PipelineBuilder<DocOf<Src>, "subpipeline", "empty">, vars: VarsOf<V>) => R;
    },
  ): PipelineBuilder<ApplyLookup<T, As, RowOf<R>>, M, "staged">;
  /**
   * `$lookup` without `from`: the sub-pipeline makes its own documents (`$documents`).
   *
   * @typeParam As - The name of the result array field.
   * @typeParam R - The staged sub-pipeline.
   * @typeParam V - The `let` variables.
   * @param spec - The result field, the optional variables and the pipeline callback.
   * @returns A builder whose rows hold the sub-pipeline rows in `as`.
   * @throws {ConfigurationError} When a variable name is invalid or the sub-pipeline has no stage.
   */
  lookup<
    const As extends string,
    R extends StagedPipeline,
    const V extends Record<string, unknown> = Record<never, never>,
  >(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly as: As;
      readonly let?: (f: FieldProxy<T>) => V & ExprValues<V>;
      readonly pipeline: (p: PipelineBuilder<never, "subpipeline", "empty">, vars: VarsOf<V>) => R;
    },
  ): PipelineBuilder<ApplyLookup<T, As, RowOf<R>>, M, "staged">;
  /**
   * `$lookup` by equality: `localField` of this document, `foreignField` of the joined one; the joined
   * type comes from `from` (an entity or a model).
   *
   * @typeParam Src - The entity class or typed source to join.
   * @typeParam As - The name of the result array field.
   * @param spec - The source, the two fields and the result field.
   * @returns A builder whose rows hold the joined documents in `as`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/
   */
  lookup<Src extends SourceInput, const As extends string>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly from: Src;
      readonly localField: DocPaths<T>;
      readonly foreignField: DocPaths<DocOf<Src>>;
      readonly as: As;
    },
  ): PipelineBuilder<ApplyLookup<T, As, DocOf<Src>>, M, "staged">;
  lookup(
    this: PipelineBuilder<T, PipelineMode, PipelineState>,
    spec: {
      readonly from?: SourceInput;
      readonly as: string;
      readonly localField?: string;
      readonly foreignField?: string;
      readonly let?: (f: FieldProxy<T>) => Record<string, unknown>;
      readonly pipeline?: AnySubPipeline;
    },
  ): unknown {
    const vars = letVariables(spec.let);
    const pipeline =
      spec.pipeline === undefined
        ? undefined
        : PipelineBuilder.#stagesOf(callSub(spec.pipeline, vars.proxies), "$lookup.pipeline");
    const stage = {
      $lookup: {
        ...(spec.from === undefined ? {} : { from: PipelineSources.collectionOf(spec.from) }),
        ...(spec.localField === undefined ? {} : { localField: spec.localField }),
        ...(spec.foreignField === undefined ? {} : { foreignField: spec.foreignField }),
        ...(vars.spec === undefined ? {} : { let: vars.spec }),
        ...(pipeline === undefined ? {} : { pipeline }),
        as: spec.as,
      },
    };
    return this.#next(spec.from === undefined ? stage : PipelineSources.named(stage, spec.from));
  }

  /**
   * `$graphLookup`: recursive search in `from`; `startWith` is an expression of this document; with
   * `depthField` every joined document carries its depth (an int64).
   *
   * @typeParam Src - The entity class or typed source to search.
   * @typeParam As - The name of the result array field.
   * @typeParam Depth - The `depthField` name, or `undefined`.
   * @param spec - The source, the start expression, the connecting fields and the options.
   * @returns A builder whose rows hold the joined documents in `as`.
   * @throws {ConfigurationError} When `maxDepth` is not an integer ≥ 0.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/graphLookup/
   */
  graphLookup<Src extends SourceInput, const As extends string, const Depth extends string | undefined = undefined>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly from: Src;
      readonly startWith: (f: FieldProxy<T>) => Arg<unknown>;
      readonly connectFromField: DocPaths<DocOf<Src>>;
      readonly connectToField: DocPaths<DocOf<Src>>;
      readonly as: As;
      readonly maxDepth?: number;
      readonly depthField?: Depth;
      readonly restrictSearchWithMatch?: MatchFilter<DocOf<Src>>;
    },
  ): PipelineBuilder<ApplyLookup<T, As, Simplify<WithDepth<DocOf<Src>, Depth>>>, M, "staged"> {
    if (spec.maxDepth !== undefined) assertInteger("$graphLookup.maxDepth", spec.maxDepth, 0);
    const { from, startWith, restrictSearchWithMatch, ...rest } = spec;
    return this.#next(
      PipelineSources.named(
        {
          $graphLookup: {
            ...rest,
            from: PipelineSources.collectionOf(from),
            startWith: ExprNodes.serialize(startWith(this.#f())),
            ...(restrictSearchWithMatch === undefined
              ? {}
              : { restrictSearchWithMatch: ExprCompiler.resolveFilter(restrictSearchWithMatch) }),
          },
        },
        from,
      ),
    );
  }

  /**
   * `$unionWith` of another collection: the rows are `T | Joined` (a real union, not an intersection with a
   * record).
   *
   * @typeParam Src - The entity class or typed source to add.
   * @param source - The collection to add.
   * @returns A builder whose rows are the current rows or the added documents.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/unionWith/
   */
  unionWith<Src extends SourceInput>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    source: Src,
  ): PipelineBuilder<T | DocOf<Src>, M, "staged">;
  /**
   * `$unionWith` of another collection through a sub-pipeline.
   *
   * @typeParam Src - The entity class or typed source to add.
   * @typeParam R - The staged sub-pipeline.
   * @param spec - The collection and the callback that builds the sub-pipeline.
   * @returns A builder whose rows are the current rows or the sub-pipeline rows.
   */
  unionWith<Src extends SourceInput, R extends StagedPipeline>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: { readonly coll: Src; readonly pipeline: (p: PipelineBuilder<DocOf<Src>, "subpipeline", "empty">) => R },
  ): PipelineBuilder<T | RowOf<R>, M, "staged">;
  /**
   * `$unionWith` of documents a sub-pipeline makes (`$documents`).
   *
   * @typeParam R - The staged sub-pipeline.
   * @param spec - The callback that builds the sub-pipeline.
   * @returns A builder whose rows are the current rows or the sub-pipeline rows.
   * @throws {ConfigurationError} When the sub-pipeline has no stage.
   */
  unionWith<R extends StagedPipeline>(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: { readonly pipeline: (p: PipelineBuilder<never, "subpipeline", "empty">) => R },
  ): PipelineBuilder<T | RowOf<R>, M, "staged">;
  unionWith(
    this: PipelineBuilder<T, PipelineMode, PipelineState>,
    arg:
      | SourceInput
      | {
          readonly coll?: SourceInput;
          readonly pipeline: AnySubPipeline;
        },
  ): unknown {
    if (typeof arg === "function" || !("pipeline" in arg && typeof arg.pipeline === "function")) {
      return this.#next(
        PipelineSources.named({ $unionWith: PipelineSources.collectionOf(arg as SourceInput) }, arg as SourceInput),
      );
    }
    const pipeline = PipelineBuilder.#stagesOf(callSub(arg.pipeline, {}), "$unionWith.pipeline");
    const stage = {
      $unionWith: {
        ...(arg.coll === undefined ? {} : { coll: PipelineSources.collectionOf(arg.coll) }),
        pipeline,
      },
    };
    return this.#next(arg.coll === undefined ? stage : PipelineSources.named(stage, arg.coll));
  }

  /**
   * `$facet`: one array of rows per branch; a branch cannot hold `$facet`, `$out`, `$merge` or a
   * first-stage-only stage.
   *
   * @typeParam B - The branch callbacks by name.
   * @param branches - One callback per branch that builds its sub-pipeline.
   * @returns A builder whose single row holds an array of rows per branch.
   * @throws {ConfigurationError} When there are no branches or a branch has no stage.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet/
   */
  facet<const B extends Record<string, (branch: PipelineBuilder<T, "facet", "empty">) => StagedPipeline>>(
    this: PipelineBuilder<T, FacetHostMode, PipelineState>,
    branches: B,
  ): PipelineBuilder<{ -readonly [K in keyof B]: RowOf<ReturnType<B[K]>>[] }, M, "staged"> {
    const spec: Record<string, readonly PipelineStage[]> = {};
    for (const [name, branch] of Object.entries(branches as B)) {
      spec[name] = PipelineBuilder.#stagesOf(branch(PipelineBuilder.#sub()), `$facet.${name}`);
    }
    if (Object.keys(spec).length === 0) throw new ConfigurationError("$facet needs at least one branch");
    return this.#next({ $facet: spec });
  }

  /* ---- first-stage-only stages of a collection ---- */

  /**
   * `$geoNear` (first stage, also of a `$lookup` sub-pipeline; not in `$facet`): adds `distanceField` and, with
   * `includeLocs`, the matched location.
   *
   * @typeParam D - The `distanceField` path.
   * @typeParam L - The `includeLocs` path, or `undefined`.
   * @param spec - The point, the distance field and the options.
   * @returns A builder whose rows carry the distance and, optionally, the location.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/geoNear/
   */
  geoNear<const D extends string, const L extends string | undefined = undefined>(
    this: PipelineBuilder<T, "collection" | "view" | "subpipeline", "empty">,
    spec: {
      readonly near: GeoPointInput;
      readonly distanceField: D;
      readonly key?: DocPaths<T>;
      readonly query?: MatchFilter<T>;
      readonly spherical?: boolean;
      readonly maxDistance?: number;
      readonly minDistance?: number;
      readonly distanceMultiplier?: number;
      readonly includeLocs?: L;
    },
  ): PipelineBuilder<ApplyGeoNear<T, D, L>, M, "staged"> {
    const { query, ...rest } = spec;
    return this.#next({
      $geoNear: { ...rest, ...(query === undefined ? {} : { query: ExprCompiler.resolveFilter(query) }) },
    });
  }

  /**
   * `$search` (Atlas Search, first stage; typed on input).
   *
   * @param spec - The index name and the search operator.
   * @returns A builder with the same rows.
   * @see https://www.mongodb.com/docs/atlas/atlas-search/aggregation-stages/search/
   */
  search(
    this: PipelineBuilder<T, "collection" | "subpipeline", "empty">,
    spec: SearchSpec<T>,
  ): PipelineBuilder<T, M, "staged"> {
    return this.#next({ $search: spec });
  }

  /**
   * `$searchMeta` (Atlas Search metadata, first stage).
   *
   * @param spec - The search operator, or a facet collector.
   * @returns A builder whose rows are the search metadata.
   * @see https://www.mongodb.com/docs/atlas/atlas-search/aggregation-stages/searchMeta/
   */
  searchMeta(
    this: PipelineBuilder<T, "collection" | "subpipeline", "empty">,
    spec: SearchSpec<T> | ({ readonly index?: string } & { readonly facet: AnyDocument }),
  ): PipelineBuilder<SearchMetaRow, M, "staged"> {
    return this.#next({ $searchMeta: spec });
  }

  /**
   * `$vectorSearch` (Atlas Vector Search, first stage).
   *
   * @param spec - The index, the path, the query vector and the limits.
   * @returns A builder with the same rows.
   * @see https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/
   */
  vectorSearch(
    this: PipelineBuilder<T, "collection" | "subpipeline", "empty">,
    spec: VectorSearchSpec<T>,
  ): PipelineBuilder<T, M, "staged"> {
    return this.#next({ $vectorSearch: spec });
  }

  /**
   * `$rankFusion` (first stage, MongoDB 8.1+): combines ranked sub-pipelines by reciprocal rank.
   *
   * @typeParam Names - The names of the input pipelines.
   * @param spec - The named input pipelines and the optional weights and score details.
   * @returns A builder with the same rows.
   * @throws {ConfigurationError} When an input pipeline has no stage.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankFusion/
   */
  rankFusion<const Names extends string>(
    this: PipelineBuilder<T, "collection", "empty">,
    spec: {
      readonly input: {
        readonly pipelines: {
          readonly [K in Names]: (p: PipelineBuilder<T, "subpipeline", "empty">) => StagedPipeline;
        };
      };
      readonly combination?: { readonly weights?: { readonly [K in Names]?: number } };
      readonly scoreDetails?: boolean;
    },
  ): PipelineBuilder<T, M, "staged"> {
    return this.#next({ $rankFusion: PipelineBuilder.#fusion(spec) });
  }

  /**
   * `$scoreFusion` (first stage, MongoDB 8.2+): combines scored sub-pipelines.
   *
   * @typeParam Names - The names of the input pipelines.
   * @param spec - The named input pipelines with the normalization, and the optional combination and score details.
   * @returns A builder with the same rows.
   * @throws {ConfigurationError} When an input pipeline has no stage.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/scoreFusion/
   */
  scoreFusion<const Names extends string>(
    this: PipelineBuilder<T, "collection", "empty">,
    spec: {
      readonly input: {
        readonly pipelines: {
          readonly [K in Names]: (p: PipelineBuilder<T, "subpipeline", "empty">) => StagedPipeline;
        };
        readonly normalization: ScoreNormalization;
      };
      readonly combination?: { readonly weights?: { readonly [K in Names]?: number }; readonly method?: "avg" };
      readonly scoreDetails?: boolean;
    },
  ): PipelineBuilder<T, M, "staged"> {
    return this.#next({ $scoreFusion: PipelineBuilder.#fusion(spec) });
  }

  /**
   * Builds the body of `$rankFusion` / `$scoreFusion`: every input pipeline callback is replaced by its stages.
   *
   * @param spec - The fusion spec with the input pipeline callbacks.
   * @returns The serialized spec.
   * @throws {ConfigurationError} When an input pipeline has no stage.
   */
  static #fusion(spec: {
    readonly input: { readonly pipelines: Readonly<Record<string, AnySubPipeline>> };
  }): Record<string, unknown> {
    const pipelines: Record<string, readonly PipelineStage[]> = {};
    for (const [name, build] of Object.entries(spec.input.pipelines)) {
      pipelines[name] = PipelineBuilder.#stagesOf(callSub(build, {}), `input.pipelines.${name}`);
    }
    return { ...spec, input: { ...spec.input, pipelines } };
  }

  /**
   * `$score` (MongoDB 8.2+): sets the document's score (`fn.meta("score")`) from an expression.
   *
   * @param spec - The score expression callback and the optional normalization and weight.
   * @returns A builder with the same rows.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/score/
   */
  score(
    this: PipelineBuilder<T, GeneralMode, PipelineState>,
    spec: {
      readonly score: (f: FieldProxy<T>) => Arg<number>;
      readonly normalization?: ScoreNormalization;
      readonly weight?: number;
    },
  ): PipelineBuilder<T, M, "staged"> {
    return this.#next({ $score: { ...spec, score: ExprNodes.serialize(spec.score(this.#f())) } });
  }

  /**
   * `$collStats` (first stage): the requested sections.
   *
   * @typeParam Sp - The stats spec.
   * @param spec - The sections to report; unknown keys are rejected.
   * @returns A builder whose rows hold the requested sections.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/collStats/
   */
  collStats<const Sp extends CollStatsSpec>(
    this: PipelineBuilder<T, "collection", "empty">,
    spec: Sp & Exact<Sp, CollStatsSpec>,
  ): PipelineBuilder<Simplify<CollStatsRow<Sp>>, M, "staged"> {
    return this.#next({ $collStats: spec });
  }

  /**
   * `$indexStats` (first stage): one row per index.
   *
   * @returns A builder whose rows are the index statistics.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/indexStats/
   */
  indexStats(this: PipelineBuilder<T, "collection", "empty">): PipelineBuilder<IndexStatsRow, M, "staged"> {
    return this.#next({ $indexStats: {} });
  }

  /**
   * `$planCacheStats` (first stage).
   *
   * @param spec - The options.
   * @returns A builder whose rows are the plan cache entries.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/planCacheStats/
   */
  planCacheStats(
    this: PipelineBuilder<T, "collection", "empty">,
    spec: PlanCacheStatsSpec = {},
  ): PipelineBuilder<PlanCacheStatsRow, M, "staged"> {
    return this.#next({ $planCacheStats: spec });
  }

  /**
   * `$listSearchIndexes` (first stage).
   *
   * @param spec - An optional index id or name to list.
   * @returns A builder whose rows are the search indexes.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/listSearchIndexes/
   */
  listSearchIndexes(
    this: PipelineBuilder<T, "collection", "empty">,
    spec: { readonly id?: string } | { readonly name?: string } = {},
  ): PipelineBuilder<SearchIndexRow, M, "staged"> {
    return this.#next({ $listSearchIndexes: spec });
  }

  /**
   * `$listSessions` (first stage of `Pipeline.sessions()`: the server runs it only on the collection
   * `config.system.sessions`, so a model's aggregation cannot hold it).
   *
   * @param spec - Which users' sessions to list.
   * @returns A builder whose rows are the sessions.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/listSessions/
   */
  listSessions(
    this: PipelineBuilder<T, "sessions", "empty">,
    spec: ListSessionsSpec = {},
  ): PipelineBuilder<SessionRow, M, "staged"> {
    return this.#next({ $listSessions: spec });
  }

  /* ---- first-stage-only stages of a database aggregation ---- */

  /**
   * `$documents` (first stage of a database aggregation or of a sub-pipeline): literal documents (values
   * may be expressions).
   *
   * @typeParam D - The tuple of documents.
   * @param docs - The documents.
   * @returns A builder whose rows are the documents.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/documents/
   */
  documents<const D extends readonly [Record<string, unknown>, ...Record<string, unknown>[]]>(
    this: PipelineBuilder<T, "database" | "admin" | "subpipeline", "empty">,
    docs: D,
  ): PipelineBuilder<Simplify<UnwrapDeep<D[number]>>, M, "staged"> {
    return this.#next({ $documents: ExprNodes.serialize(docs) });
  }

  /**
   * `$currentOp` (first stage, admin database).
   *
   * @param spec - The options.
   * @returns A builder whose rows are the running operations.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/currentOp/
   */
  currentOp(
    this: PipelineBuilder<T, "admin", "empty">,
    spec: CurrentOpSpec = {},
  ): PipelineBuilder<CurrentOpRow, M, "staged"> {
    return this.#next({ $currentOp: spec });
  }

  /**
   * `$listLocalSessions` (first stage of a database aggregation).
   *
   * @param spec - Which users' sessions to list.
   * @returns A builder whose rows are the sessions.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/listLocalSessions/
   */
  listLocalSessions(
    this: PipelineBuilder<T, "database" | "admin", "empty">,
    spec: ListSessionsSpec = {},
  ): PipelineBuilder<SessionRow, M, "staged"> {
    return this.#next({ $listLocalSessions: spec });
  }

  /**
   * `$queryStats` (first stage, admin database).
   *
   * @param spec - The options.
   * @returns A builder whose rows are the query statistics.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/queryStats/
   */
  queryStats(
    this: PipelineBuilder<T, "admin", "empty">,
    spec: QueryStatsSpec = {},
  ): PipelineBuilder<QueryStatsRow, M, "staged"> {
    return this.#next({ $queryStats: spec });
  }

  /**
   * `$listSampledQueries` (first stage, admin database, sharded clusters).
   *
   * @param spec - An optional namespace to list.
   * @returns A builder whose rows are the sampled queries.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/listSampledQueries/
   */
  listSampledQueries(
    this: PipelineBuilder<T, "admin", "empty">,
    spec: { readonly namespace?: string } = {},
  ): PipelineBuilder<SampledQueryRow, M, "staged"> {
    return this.#next({ $listSampledQueries: spec });
  }

  /**
   * `$listClusterCatalog` (first stage of a database aggregation, MongoDB 8.1+).
   *
   * @param spec - The options.
   * @returns A builder whose rows are the catalog entries.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/listClusterCatalog/
   */
  listClusterCatalog(
    this: PipelineBuilder<T, "database" | "admin", "empty">,
    spec: ClusterCatalogSpec = {},
  ): PipelineBuilder<ClusterCatalogRow, M, "staged"> {
    return this.#next({ $listClusterCatalog: spec });
  }

  /**
   * `$shardedDataDistribution` (first stage, admin database, sharded clusters).
   *
   * @returns A builder whose rows are the data distribution per collection.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/shardedDataDistribution/
   */
  shardedDataDistribution(
    this: PipelineBuilder<T, "admin", "empty">,
  ): PipelineBuilder<ShardedDataDistributionRow, M, "staged"> {
    return this.#next({ $shardedDataDistribution: {} });
  }

  /**
   * `$querySettings` (first stage, admin database, MongoDB 8.0+).
   *
   * @param spec - The options.
   * @returns A builder whose rows are the query settings.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/querySettings/
   */
  querySettings(
    this: PipelineBuilder<T, "admin", "empty">,
    spec: { readonly showDebugQueryShape?: boolean } = {},
  ): PipelineBuilder<QuerySettingsRow, M, "staged"> {
    return this.#next({ $querySettings: spec });
  }

  /**
   * `$changeStream` (first stage): the rows are change events of the driver's `ChangeStreamDocument`.
   *
   * @param spec - The stage options.
   * @returns A builder whose rows are change events.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/changeStream/
   */
  changeStream(
    this: PipelineBuilder<T, "collection" | "database" | "admin", "empty">,
    spec: ChangeStreamStageSpec & { readonly allChangesForCluster?: boolean } = {},
  ): PipelineBuilder<
    ChangeStreamDocument<[T] extends [never] ? AnyDocument : T extends AnyDocument ? T : T & AnyDocument>,
    M,
    "staged"
  > {
    return this.#next({ $changeStream: spec });
  }

  /**
   * `$changeStreamSplitLargeEvent` (last stage of a change stream pipeline): events over 16 MB are split.
   *
   * @returns A sealed pipeline: no more stages can be added.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/changeStreamSplitLargeEvent/
   */
  changeStreamSplitLargeEvent(
    this: PipelineBuilder<T, "watch" | "collection" | "database" | "admin", PipelineState>,
  ): SealedPipeline<Simplify<T & SplitEventFields>> {
    return new SealedPipeline([...this.#stages, freezeStage({ $changeStreamSplitLargeEvent: {} })]);
  }

  /* ---- terminal stages ---- */

  /**
   * `$out` into an entity's collection: the rows must fit the class (materialized result, row check).
   *
   * @typeParam Src - The entity class or typed source written to.
   * @param target - The target; the rows must fit its documents.
   * @returns A terminal pipeline: no more stages can be added.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/out/
   */
  out<Src extends SourceInput>(
    this: PipelineBuilder<T, TopMode, "staged">,
    target: Src & RowFits<T, Src>,
  ): TerminalPipeline;
  /**
   * `$out` into a named collection: `"name"` (this database) or `{ db, coll }` with both fields, optionally
   * time series (a target object without `db` or `coll` is refused before anything is sent); nothing to check the
   * rows against.
   *
   * @param target - The collection name, or `{ db, coll }`.
   * @returns A terminal pipeline: no more stages can be added.
   * @throws {ConfigurationError} When the object form lacks `db` or `coll`, or the target is a database-level source.
   */
  out(this: PipelineBuilder<T, TopMode, "staged">, target: OutCollection): TerminalPipeline;
  out(this: PipelineBuilder<T, PipelineMode, PipelineState>, target: SourceInput | OutCollection): TerminalPipeline {
    if (isTargetObject(target)) assertTargetObject("$out", target, true);
    const named = typeof target !== "string" && !("coll" in target && typeof target.coll === "string");
    const spec = named
      ? PipelineSources.collectionOf(target as SourceInput)
      : typeof target === "string"
        ? target
        : { ...target };
    const stage = { $out: spec };
    return new TerminalPipeline(
      this.#target,
      [...this.#stages, freezeStage(named ? PipelineSources.named(stage, target as SourceInput) : stage)],
      this.#options,
    );
  }

  /**
   * `$merge` into an entity's collection: `on` names fields of the target (a unique index is required
   * on them), `whenMatched` may be a pipeline over the target document with `$$new` (or `let`'s variables).
   * Rows that may be inserted must fit the class.
   *
   * @typeParam Src - The entity class or typed source written to.
   * @typeParam V - The `let` variables.
   * @param spec - The target, the match fields, the optional variables and the match behaviours.
   * @returns A terminal pipeline: no more stages can be added.
   * @throws {ConfigurationError} When a variable name is invalid, the `whenMatched` pipeline has no stage, or a
   *   target object has no `coll`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/
   */
  merge<Src extends SourceInput, const V extends Record<string, unknown> = Record<never, never>>(
    this: PipelineBuilder<T, TopMode, "staged">,
    spec: {
      readonly into: Src & RowFits<T, Src>;
      readonly on?:
        | DocPaths<StoredDocOf<Src>>
        | "_id"
        | readonly [DocPaths<StoredDocOf<Src>> | "_id", ...(DocPaths<StoredDocOf<Src>> | "_id")[]];
      readonly let?: (f: FieldProxy<T>) => V & ExprValues<V>;
      readonly whenMatched?:
        | MergeWhenMatched
        | ((p: PipelineBuilder<StoredDocOf<Src>, "update", "empty">, vars: MergeVars<T, V>) => StagedPipeline);
      readonly whenNotMatched?: MergeWhenNotMatched;
    },
  ): TerminalPipeline;
  /**
   * `$merge` into a named collection.
   *
   * @param spec - The target, the optional match fields and the match behaviours.
   * @returns A terminal pipeline: no more stages can be added.
   */
  merge(
    this: PipelineBuilder<T, TopMode, "staged">,
    spec: {
      readonly into: NamedCollection;
      readonly on?: string | readonly [string, ...string[]];
      readonly whenMatched?: MergeWhenMatched;
      readonly whenNotMatched?: MergeWhenNotMatched;
    },
  ): TerminalPipeline;
  merge(
    this: PipelineBuilder<T, PipelineMode, PipelineState>,
    spec: {
      readonly into: SourceInput | NamedCollection;
      readonly on?: string | readonly string[];
      readonly let?: (f: FieldProxy<T>) => Record<string, unknown>;
      readonly whenMatched?: MergeWhenMatched | AnySubPipeline;
      readonly whenNotMatched?: MergeWhenNotMatched;
    },
  ): TerminalPipeline {
    if (isTargetObject(spec.into)) assertTargetObject("$merge", spec.into, false);
    const named = !("coll" in spec.into && typeof spec.into.coll === "string");
    const into = named ? PipelineSources.collectionOf(spec.into as SourceInput) : { ...spec.into };
    const vars = letVariables(spec.let);
    const proxies = vars.spec === undefined ? { new: FieldProxies.variable("new") } : vars.proxies;
    const whenMatched =
      typeof spec.whenMatched === "function"
        ? PipelineBuilder.#stagesOf(callSub(spec.whenMatched, proxies), "$merge.whenMatched")
        : spec.whenMatched;
    const stage = {
      into,
      ...(spec.on === undefined ? {} : { on: typeof spec.on === "string" ? spec.on : [...spec.on] }),
      ...(vars.spec === undefined ? {} : { let: vars.spec }),
      ...(whenMatched === undefined ? {} : { whenMatched }),
      ...(spec.whenNotMatched === undefined ? {} : { whenNotMatched: spec.whenNotMatched }),
    };
    const merge = { $merge: stage };
    return new TerminalPipeline(
      this.#target,
      [...this.#stages, freezeStage(named ? PipelineSources.named(merge, spec.into as SourceInput) : merge)],
      this.#options,
    );
  }

  /* ---- output ---- */

  /**
   * The stages, frozen (for a sub-pipeline, a view definition, an update or change stream pipeline).
   *
   * @returns The serialized stages.
   */
  build(): readonly PipelineStage[] {
    return this.#handedOut();
  }

  /**
   * The plan of a top-level aggregation with at least one stage (executed by the operation pipeline).
   *
   * @returns The frozen aggregation plan.
   * @throws {ConfigurationError} When the pipeline has no source or no stage.
   */
  plan(this: PipelineBuilder<T, TopMode | "sessions", "staged">): AggregatePlan<T> {
    if (this.#target === undefined) throw new ConfigurationError("this pipeline has no source to run on");
    /* The type already requires a stage; this guards untyped callers (Mongoose: "empty pipeline"). */
    if (this.#stages.length === 0) throw new ConfigurationError("an empty pipeline does not run: add a stage");
    return Object.freeze({
      op: "aggregate",
      target: this.#target,
      pipeline: this.#handedOut(),
      options: this.#options,
    });
  }
}
