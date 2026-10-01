import type { UpdatePipelineFor } from "../aggregate/expressions/public.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import { QueryError } from "../errors/query-error.ts";
import { PolicyContext } from "../policies/policy-context.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import type { IdInputOf, IdOf, LeanOf, Replacement } from "../types/document-forms.ts";
import type { Filter, FilterPaths, FilterValue } from "../types/filter.ts";
import type { NoNarrowing } from "../types/narrow.ts";
import type { FilterCheck, WriteFilterCheck } from "../types/path-check.ts";
import type { DeleteResult, UpdateResult } from "../types/result.ts";
import type { FindOneAndUpdateOptions, Update, UpdateCheck, UpdateOptions } from "../types/update.ts";
import { CountQuery } from "./count-query.ts";
import { OptionQuery } from "./option-query.ts";
import type {
  FindOperation,
  ModifyOperation,
  PlanDocument,
  PlanExecutor,
  ValueOperation,
  WriteOperation,
} from "./plan.ts";
import { PlanValues } from "./plan-values.ts";
import { QueryBuilder, type QueryState } from "./query-builder.ts";
import { UpdatePlanner } from "./update-planner.ts";
import { WriteBuilder } from "./write-builder.ts";

/*
 * The typed entry points of one model: each method builds a query or write builder over an
 * `OperationPlan`. The `Model` composes this class with its executor (the operation pipeline); tests can
 * give it a plan runner over the raw driver.
 */

/**
 * The element type of a (readonly) array, recursively; the value itself otherwise.
 *
 * @typeParam V - The value type.
 * @example
 * type A = Element<string[][]>; // string
 */
type Element<V> = V extends readonly (infer E)[] ? Element<E> : V;

/**
 * A value of `distinct(path)`: array fields are unwound (as the server does), `null` only on nullable paths.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The path.
 * @example
 * type A = DistinctValue<{ tags: string[] }, "tags">; // string
 * type B = DistinctValue<{ nick: string | null }, "nick">; // string | null
 */
export type DistinctValue<T, P extends string> =
  | LeanOf<Element<NonNullable<FilterValue<T, P>>>>
  | Extract<FilterValue<T, P>, null>;

/**
 * `findOneAndUpdate`/`findOneAndReplace` with `upsert: true` and `"after"` always return a document.
 *
 * @typeParam O - The options type.
 * @example
 * type A = UpsertFound<{ upsert: true }>; // true
 * type B = UpsertFound<{ upsert: true; returnDocument: "before" }>; // false
 */
export type UpsertFound<O> = O extends { readonly upsert: true }
  ? O extends { readonly returnDocument: "before" }
    ? false
    : true
  : false;

/**
 * Options of an update with an update pipeline (no `arrayFilters`: a pipeline has no positional paths).
 *
 * @example
 * const options: PipelineUpdateOptions = { upsert: true };
 */
export interface PipelineUpdateOptions {
  /** Inserts a document when nothing matches. */
  readonly upsert?: boolean;
}

/**
 * Options of `findOneAndUpdate` with an update pipeline.
 *
 * @example
 * const options: PipelineFindOneAndUpdateOptions = { upsert: true, returnDocument: "before" };
 */
export interface PipelineFindOneAndUpdateOptions extends PipelineUpdateOptions {
  /** `"after"` by default. */
  readonly returnDocument?: "before" | "after";
}

/**
 * The options every update implementation reads, whatever the overload.
 *
 * @example
 * const args: UpdateArgs = { upsert: true, arrayFilters: [{ "i.sku": "a" }] };
 */
type UpdateArgs = { readonly upsert?: boolean; readonly arrayFilters?: unknown };

/**
 * Options of `replaceOne`.
 *
 * @example
 * const options: ReplaceOptions = { upsert: true };
 */
export interface ReplaceOptions {
  /** Inserts the replacement when nothing matches. */
  readonly upsert?: boolean;
}

/**
 * Options of `findOneAndReplace`.
 *
 * @example
 * const options: FindOneAndReplaceOptions = { upsert: true, returnDocument: "after" };
 */
export interface FindOneAndReplaceOptions extends ReplaceOptions {
  /** `"after"` by default. */
  readonly returnDocument?: "before" | "after";
}

/**
 * The queries and writes of the documents of `T`.
 *
 * @typeParam T - The entity type.
 * @example
 * const ops = new ModelOperations(User, executor);
 * const adults = await ops.find({ age: { $gte: 18 } }).sort({ age: 1 });
 */
export class ModelOperations<T extends object> {
  readonly entity: EntityClass<T>;
  readonly #executor: PlanExecutor;

  /**
   * @param entity - The entity class of the model.
   * @param executor - Runs the plans the operations build.
   */
  constructor(entity: EntityClass<T>, executor: PlanExecutor) {
    this.entity = entity;
    this.#executor = executor;
  }

  /**
   * The initial builder state of a find or find-and-modify.
   *
   * @param op - The operation kind.
   * @param filter - The user's filter, if any.
   * @param extra - State to set over the defaults.
   * @returns The state; the policy options are the ambient ones captured now.
   * @throws {QueryError} When `filter` is not an object or holds `undefined`.
   */
  private state(op: FindOperation | ModifyOperation, filter: unknown, extra: Partial<QueryState> = {}): QueryState {
    return {
      op,
      entity: this.entity,
      executor: this.#executor,
      clauses: filter === undefined ? [] : [ModelOperations.filter(filter)],
      upsert: false,
      returnDocument: "after",
      populate: Object.freeze([]),
      lean: false,
      orFail: false,
      options: Object.freeze(PolicyContext.captured()),
      ...extra,
    };
  }

  /**
   * A checked, frozen copy of a filter.
   *
   * @param filter - The user's filter.
   * @returns The copy.
   * @throws {QueryError} When `filter` is not an object or holds `undefined`, a function, or an empty logical list.
   */
  private static filter(filter: unknown): PlanDocument {
    if (!BsonGuards.isPlainObject(filter)) throw new QueryError("filter: an object");
    return PlanValues.filter(filter, "filter");
  }

  /**
   * A checked, frozen copy of a replacement document.
   *
   * @param replacement - The user's replacement.
   * @returns The copy.
   * @throws {QueryError} When `replacement` is not an object, has an operator key, or holds `undefined`.
   */
  private static replacement(replacement: unknown): PlanDocument {
    if (!BsonGuards.isPlainObject(replacement)) throw new QueryError("replacement: a document");
    const operator = Object.keys(replacement).find((key) => key.startsWith("$"));
    if (operator !== undefined)
      throw new QueryError(`replacement: "${operator}" — a replacement has no operators`, { path: operator });
    return PlanValues.copyObject(replacement, "", "replacement");
  }

  /**
   * A write builder over a new plan.
   *
   * @typeParam R - The driver result.
   * @param op - The write operation.
   * @param filter - The user's filter.
   * @param extra - Plan fields to set over the defaults (update, replacement, upsert).
   * @returns The builder.
   * @throws {QueryError} When the filter is invalid.
   */
  private write<R>(op: WriteOperation, filter: unknown, extra: Record<string, unknown>): WriteBuilder<R> {
    return new WriteBuilder<R>(
      this.#executor,
      Object.freeze({
        op,
        entity: this.entity,
        options: Object.freeze(PolicyContext.captured()),
        filter: ModelOperations.filter(filter),
        upsert: false,
        orFail: false,
        ...extra,
      }),
    );
  }

  /**
   * A query that returns a value (count, distinct values) over a new plan.
   *
   * @typeParam R - The value type.
   * @param op - The value operation.
   * @param filter - The user's filter; all documents when omitted.
   * @param extra - Plan fields to set over the defaults (`field` of `distinct`).
   * @returns The query.
   * @throws {QueryError} When the filter is invalid.
   */
  private value<R>(op: ValueOperation, filter: unknown, extra: Record<string, unknown> = {}): OptionQuery<R> {
    return new OptionQuery<R>(
      this.#executor,
      Object.freeze({
        op,
        entity: this.entity,
        options: Object.freeze(PolicyContext.captured()),
        filter: ModelOperations.filter(filter ?? {}),
        ...extra,
      }),
    );
  }

  /* ---- reads ---- */

  /**
   * Documents matching `filter` (all when omitted).
   *
   * The compiler checks the paths of a filter whose keys it sees (a literal, an object typed with its fields).
   * A dynamic filter typed `Record<string, unknown>` compiles whatever its keys are: they are checked when the
   * query runs, and an unknown path is a `StrictModeError` (reason `"unknown-path"`) before the server is asked.
   *
   * @param filter - The filter; all documents when omitted.
   * @returns A query builder for the documents.
   * @throws {QueryError} When `filter` is invalid.
   * @throws {StrictModeError} When the query runs with a filter path the schema does not declare.
   * @example
   * const adults = await User.find({ age: { $gte: 18 } }).sort({ name: 1 });
   */
  find<F extends Filter<T, true>>(
    filter?: F & NoInfer<FilterCheck<T, F>>,
  ): QueryBuilder<T, "find", undefined, never, false, false, NoNarrowing, never> {
    return new QueryBuilder<T, "find">(this.state("find", filter));
  }

  /**
   * The first document matching `filter`, or `null`.
   *
   * As with `find`, a dynamic filter typed `Record<string, unknown>` is checked only when the query runs (an
   * unknown path is a `StrictModeError`).
   *
   * @param filter - The filter; any document when omitted.
   * @returns A query builder for one document.
   * @throws {QueryError} When `filter` is invalid.
   * @throws {StrictModeError} When the query runs with a filter path the schema does not declare.
   */
  findOne<F extends Filter<T, true>>(
    filter?: F & NoInfer<FilterCheck<T, F>>,
  ): QueryBuilder<T, "findOne", undefined, never, false, false, NoNarrowing, never> {
    return new QueryBuilder<T, "findOne">(this.state("findOne", filter));
  }

  /**
   * The document with this `_id` (typed by the entity's `_id`), or `null`.
   *
   * @param id - The `_id`, or its string form (an `ObjectId` as 24 hex characters, a `UUID` as its string).
   * @returns A query builder for one document.
   * @throws {QueryError} When `id` is `null` or `undefined`.
   */
  findById(id: IdInputOf<T>): QueryBuilder<T, "findOne", undefined, never, false, false, NoNarrowing, never> {
    if (id === undefined || id === null) throw new QueryError("findById: an id is required");
    return new QueryBuilder<T, "findOne">(
      this.state(
        "findOne",
        { _id: id },
        { options: Object.freeze({ ...PolicyContext.captured(), method: "findById" }) },
      ),
    );
  }

  /**
   * `{ _id }` of the first matching document, or `null`.
   *
   * @param filter - The filter.
   * @returns A query that resolves to the `_id` object or `null`.
   * @throws {QueryError} When `filter` is invalid.
   */
  exists<F extends Filter<T, true>>(filter: F & NoInfer<FilterCheck<T, F>>): OptionQuery<{ _id: IdOf<T> } | null> {
    return new OptionQuery(
      this.#executor,
      new QueryBuilder<T, "findOne">(
        this.state("findOne", filter, { lean: true, projection: Object.freeze({ _id: 1 }) }),
      ).build(),
    );
  }

  /**
   * The number of matching documents.
   *
   * @param filter - The filter; all documents when omitted.
   * @returns A count query (with `skip` and `limit`).
   * @throws {QueryError} When `filter` is invalid.
   */
  countDocuments<F extends Filter<T, true>>(filter?: F & NoInfer<FilterCheck<T, F>>): CountQuery {
    return new CountQuery(
      this.#executor,
      Object.freeze({
        op: "countDocuments",
        entity: this.entity,
        options: Object.freeze(PolicyContext.captured()),
        filter: ModelOperations.filter(filter ?? {}),
      }),
    );
  }

  /**
   * The collection's document count from its metadata (no filter, fast, may be approximate).
   *
   * @returns A query that resolves to the count.
   */
  estimatedDocumentCount(): OptionQuery<number> {
    return this.value("estimatedDocumentCount", {});
  }

  /**
   * The distinct values at `path` among matching documents (array values unwound).
   *
   * @param path - The path of the values.
   * @param filter - The filter; all documents when omitted.
   * @returns A query that resolves to the distinct values.
   * @throws {QueryError} When `path` is not a non-empty string or `filter` is invalid.
   */
  distinct<const P extends FilterPaths<T>, F extends Filter<T, true>>(
    path: P,
    filter?: F & NoInfer<FilterCheck<T, F>>,
  ): OptionQuery<DistinctValue<T, P>[]> {
    if (typeof path !== "string" || path === "") throw new QueryError("distinct: a path");
    return this.value("distinct", filter, { field: path });
  }

  /* ---- writes ---- */

  /**
   * Updates the first matching document.
   *
   * @param filter - The filter; an empty one is refused (which document would be first is arbitrary): `Filters.all()` is the explicit "any document".
   * @param update - An object of update operators.
   * @param options - `upsert` and `arrayFilters`.
   * @returns A write builder that resolves to the update result.
   * @throws {QueryError} When the filter or the update is invalid.
   */
  updateOne<F extends Filter<T, true>, const U extends Update<T, true>>(
    filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
    update: U & NoInfer<UpdateCheck<T, U>>,
    options?: NoInfer<UpdateOptions<T, U>>,
  ): WriteBuilder<UpdateResult<IdOf<T>>>;
  /**
   * Updates the first matching document with an update pipeline (the pipeline builder's update mode).
   *
   * @param filter - The filter; an empty one is refused, see the other overload.
   * @param pipeline - The pipeline builder callback.
   * @param options - `upsert`.
   * @returns A write builder that resolves to the update result.
   * @throws {QueryError} When the filter or the pipeline is invalid.
   */
  updateOne<F extends Filter<T, true>>(
    filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
    pipeline: UpdatePipelineFor<T>,
    options?: PipelineUpdateOptions,
  ): WriteBuilder<UpdateResult<IdOf<T>>>;
  updateOne(filter: unknown, update: unknown, options?: UpdateArgs): WriteBuilder<UpdateResult<IdOf<T>>> {
    return this.write("updateOne", filter, this.updateParts(update, options));
  }

  /**
   * Updates every matching document.
   *
   * @param filter - The filter; an empty one is refused: `Filters.all()` is the explicit "every document".
   * @param update - An object of update operators.
   * @param options - `upsert` and `arrayFilters`.
   * @returns A write builder that resolves to the update result.
   * @throws {QueryError} When the filter or the update is invalid.
   */
  updateMany<F extends Filter<T, true>, const U extends Update<T, true>>(
    filter: F & NoInfer<WriteFilterCheck<T, F, "many">>,
    update: U & NoInfer<UpdateCheck<T, U>>,
    options?: NoInfer<UpdateOptions<T, U>>,
  ): WriteBuilder<UpdateResult<IdOf<T>>>;
  /**
   * Updates every matching document with an update pipeline.
   *
   * @param filter - The filter; an empty one is refused, see the other overload.
   * @param pipeline - The pipeline builder callback.
   * @param options - `upsert`.
   * @returns A write builder that resolves to the update result.
   * @throws {QueryError} When the filter or the pipeline is invalid.
   */
  updateMany<F extends Filter<T, true>>(
    filter: F & NoInfer<WriteFilterCheck<T, F, "many">>,
    pipeline: UpdatePipelineFor<T>,
    options?: PipelineUpdateOptions,
  ): WriteBuilder<UpdateResult<IdOf<T>>>;
  updateMany(filter: unknown, update: unknown, options?: UpdateArgs): WriteBuilder<UpdateResult<IdOf<T>>> {
    return this.write("updateMany", filter, this.updateParts(update, options));
  }

  /**
   * Replaces the first matching document (a full document without `_id`). Every `immutable` field must agree with
   * the stored document — the same value, or absent when the stored document has none; the server compares them
   * in the same write.
   *
   * @param filter - The filter; an empty one is refused: `Filters.all()` is the explicit "any document".
   * @param replacement - The new document.
   * @param options - `upsert`.
   * @returns A write builder that resolves to the update result.
   * @throws {QueryError} When the filter is invalid or the replacement has operator keys.
   * @throws {StrictModeError} With rule `immutable` when the replacement changes, drops or adds an immutable value
   * of the stored document (nothing is replaced).
   */
  replaceOne<F extends Filter<T, true>>(
    filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
    replacement: Replacement<T>,
    options?: ReplaceOptions,
  ): WriteBuilder<UpdateResult<IdOf<T>>> {
    return this.write("replaceOne", filter, {
      replacement: ModelOperations.replacement(replacement),
      upsert: options?.upsert === true,
    });
  }

  /**
   * Deletes the first matching document.
   *
   * @param filter - The filter; an empty one is refused: `Filters.all()` is the explicit "any document".
   * @returns A write builder that resolves to the delete result.
   * @throws {QueryError} When `filter` is invalid.
   */
  deleteOne<F extends Filter<T, true>>(filter: F & NoInfer<WriteFilterCheck<T, F, "one">>): WriteBuilder<DeleteResult> {
    return this.write("deleteOne", filter, {});
  }

  /**
   * Deletes every matching document.
   *
   * @param filter - The filter; an empty one is refused: `Filters.all()` is the explicit "every document".
   * @returns A write builder that resolves to the delete result.
   * @throws {QueryError} When `filter` is invalid.
   */
  deleteMany<F extends Filter<T, true>>(
    filter: F & NoInfer<WriteFilterCheck<T, F, "many">>,
  ): WriteBuilder<DeleteResult> {
    return this.write("deleteMany", filter, {});
  }

  /**
   * The update and upsert plan fields of an update call.
   *
   * @param update - An object of update operators, or a pipeline callback.
   * @param options - `upsert` and `arrayFilters`.
   * @returns The planned update with the `upsert` flag.
   * @throws {QueryError} When the update or the `arrayFilters` are invalid.
   */
  private updateParts(
    update: unknown,
    options: { readonly upsert?: boolean; readonly arrayFilters?: unknown } | undefined,
  ) {
    return { ...UpdatePlanner.plan(update, options?.arrayFilters), upsert: options?.upsert === true };
  }

  /* ---- find and modify ---- */

  /**
   * Updates one document and returns it — AFTER the update by default.
   *
   * @param filter - The filter.
   * @param update - An object of update operators.
   * @param options - `upsert`, `returnDocument` and `arrayFilters`.
   * @returns A query builder for the updated document.
   * @throws {QueryError} When the filter or the update is invalid.
   */
  findOneAndUpdate<
    F extends Filter<T, true>,
    const U extends Update<T, true>,
    const O extends FindOneAndUpdateOptions<T, U> = Record<never, never>,
  >(
    filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
    update: U & NoInfer<UpdateCheck<T, U>>,
    options?: O & NoInfer<FindOneAndUpdateOptions<T, U>>,
  ): QueryBuilder<T, "findOneAndUpdate", undefined, never, false, UpsertFound<O>, NoNarrowing, never>;
  /**
   * Updates one document with an update pipeline and returns it — AFTER by default.
   *
   * @param filter - The filter.
   * @param pipeline - The pipeline builder callback.
   * @param options - `upsert` and `returnDocument`.
   * @returns A query builder for the updated document.
   * @throws {QueryError} When the filter or the pipeline is invalid.
   */
  findOneAndUpdate<F extends Filter<T, true>, const O extends PipelineFindOneAndUpdateOptions = Record<never, never>>(
    filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
    pipeline: UpdatePipelineFor<T>,
    options?: O,
  ): QueryBuilder<T, "findOneAndUpdate", undefined, never, false, UpsertFound<O>, NoNarrowing, never>;
  findOneAndUpdate(
    filter: unknown,
    update: unknown,
    options?: UpdateArgs & { readonly returnDocument?: "before" | "after" },
  ): QueryBuilder<T, "findOneAndUpdate", undefined, never, false, boolean, NoNarrowing, never> {
    const query = new QueryBuilder<T, "findOneAndUpdate">(
      this.state("findOneAndUpdate", filter, {
        ...this.updateParts(update, options),
        returnDocument: options?.returnDocument ?? "after",
      }),
    );
    /* The runtime is the same; only the `Found` state differs (upsert + "after" always returns a document). */
    return query as unknown as QueryBuilder<
      T,
      "findOneAndUpdate",
      undefined,
      never,
      false,
      boolean,
      NoNarrowing,
      never
    >;
  }

  /**
   * Replaces one document and returns it — AFTER the replacement by default. Immutable fields are checked as by
   * `replaceOne`.
   *
   * @param filter - The filter.
   * @param replacement - The new document.
   * @param options - `upsert` and `returnDocument`.
   * @returns A query builder for the replaced document.
   * @throws {QueryError} When the filter is invalid or the replacement has operator keys.
   * @throws {StrictModeError} With rule `immutable` when the replacement changes, drops or adds an immutable value
   * of the stored document (nothing is replaced).
   */
  findOneAndReplace<F extends Filter<T, true>, const O extends FindOneAndReplaceOptions = Record<never, never>>(
    filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
    replacement: Replacement<T>,
    options?: O,
  ): QueryBuilder<T, "findOneAndReplace", undefined, never, false, UpsertFound<O>, NoNarrowing, never> {
    const query = new QueryBuilder<T, "findOneAndReplace">(
      this.state("findOneAndReplace", filter, {
        replacement: ModelOperations.replacement(replacement),
        upsert: options?.upsert === true,
        returnDocument: options?.returnDocument ?? "after",
      }),
    );
    return query as unknown as QueryBuilder<
      T,
      "findOneAndReplace",
      undefined,
      never,
      false,
      UpsertFound<O>,
      NoNarrowing,
      never
    >;
  }

  /**
   * Deletes one document and returns it.
   *
   * @param filter - The filter.
   * @returns A query builder for the deleted document.
   * @throws {QueryError} When `filter` is invalid.
   */
  findOneAndDelete<F extends Filter<T, true>>(
    filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
  ): QueryBuilder<T, "findOneAndDelete", undefined, never, false, false, NoNarrowing, never> {
    return new QueryBuilder<T, "findOneAndDelete">(
      this.state("findOneAndDelete", filter, { returnDocument: "before" }),
    );
  }
}
