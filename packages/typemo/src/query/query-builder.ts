import type { ClientSession, CollationOptions, ReadConcernLevel, ReadPreferenceMode } from "mongodb";
import { BsonGuards } from "../bson/bson-guards.ts";
import { TypedCursor } from "../cursor/typed-cursor.ts";
import { QueryError } from "../errors/query-error.ts";
import type { PlainReadOptions } from "../model/plain-reader.ts";
import { PolicyContext, type PolicyValues } from "../policies/policy-context.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import type { AnyStandardSchema, StandardSchemaOutput } from "../schema/standard-schema/standard-schema.ts";
import type { ExpectRows } from "../types/contract.ts";
import type { IdOf } from "../types/document-forms.ts";
import type { CompareOf, ElemMatchOperand, Filter, FilterPaths, FilterValue, Orderable } from "../types/filter.ts";
import type { NarrowExists, NarrowIn, NarrowNotIn, NoNarrowing } from "../types/narrow.ts";
import type { FilterCheck } from "../types/path-check.ts";
import type { PathError } from "../types/paths.ts";
import type {
  PopulateArgument,
  PopulateArgumentEntries,
  PopulateObjectSpec,
  PopulatePathHint,
  PopulationEntry,
  ReplaceEntries,
} from "../types/populate.ts";
import type { Projection, ProjectionCheck, Sort } from "../types/projection.ts";
import type {
  ExplainResult,
  ExplainVerbosity,
  ModifyResult,
  QueryResult,
  ReadForm,
  ResultDoc,
} from "../types/result.ts";
import type { IsAny, NonEmptyArray } from "../types/type-utils.ts";
import { type ExecOptions, ExecutableQuery, ExecutionOnce } from "./executable-query.ts";
import { ParsedQuery } from "./parsed-query.ts";
import type {
  FindOperation,
  FindPlan,
  ModifyOperation,
  ModifyPlan,
  PlanDocument,
  PlanExecutor,
  PlanOptions,
  PopulatePlan,
  QueryCursor,
  SortPair,
} from "./plan.ts";
import { PlanValues } from "./plan-values.ts";
import { PopulateSpecs } from "./populate-specs.ts";
import { ProjectionPlanner } from "./projection-planner.ts";
import { QuerySpecs } from "./query-specs.ts";
import { type ApplyMask, MaskedQuery, type MaskSpecCheck, ResponseMask } from "./response-mask.ts";

/*
 * The query builder. Immutable: every call returns a NEW builder and never touches the previous one.
 * `build()` gives the `OperationPlan`; `await` (the standard generic `then`) hands the plan to the executor.
 * A read query runs ONCE per builder object — a second `await` of the same object returns the same result
 * without a new round trip; a find-and-modify is a write and a second `await` of it is a `QueryError`.
 * Every method returns a NEW builder, i.e. a new query (Mongoose throws on any second `await`, M5 #9).
 *
 * Two halves, one object: the TYPED VIEW (`interface QueryBuilder`, `interface WhereBuilder`: the
 * result automaton of `types/result.ts` in the type parameters) and the RUNTIME (`QueryRuntime`,
 * `WhereRuntime`: ES classes that only build plans). The view is not written on the class itself:
 * TypeScript checks the bodies and the overloads of a generic class against the generic `T`, which
 * instantiates the path and populate types without a concrete entity and hit TS2589. `QueryBuilder`
 * (the value) IS the runtime class, typed by its constructor view — the same technique as `Prop`.
 *
 * Type parameters (the state of the automaton): `S` projection, `E` populate entries, `Form` (hydrated, lean, plain),
 * `Found` (`orFail`, upsert), `N`/`X` narrowing. Methods for some operations only (`skip`, `limit`,
 * `cursor` for `find`; `includeResultMetadata` for find-and-modify) say so with a `this` parameter.
 */

/** The runtime state of a builder (frozen). */
export interface QueryState {
  /** The operation the builder will run. */
  readonly op: FindOperation | ModifyOperation;
  /** The entity class of the model. */
  readonly entity: EntityClass;
  /** Runs the built plan. */
  readonly executor: PlanExecutor;
  /** The filter clauses, combined by AND. */
  readonly clauses: readonly PlanDocument[];
  /** The clause the current `where(path)` chain writes into. */
  readonly whereClause?: { readonly path: string; readonly index: number };
  /** The update document, or an update pipeline (find-and-modify). */
  readonly update?: PlanDocument | readonly PlanDocument[];
  /** The replacement document (find-and-replace). */
  readonly replacement?: PlanDocument;
  /** The `arrayFilters` of the update. */
  readonly arrayFilters?: readonly PlanDocument[];
  /** Insert a document when nothing matches. */
  readonly upsert: boolean;
  /** Which version a find-and-modify returns. */
  readonly returnDocument: "before" | "after";
  /** The projection document. */
  readonly projection?: PlanDocument;
  /** The text score field, and whether it also sorts. */
  readonly textScore?: { readonly name: string; readonly sort: boolean };
  /** The sort pairs. */
  readonly sort?: readonly SortPair[];
  /** The number of documents to skip. */
  readonly skip?: number;
  /** The maximum number of documents. */
  readonly limit?: number;
  /** The populate instructions. */
  readonly populate: readonly PopulatePlan[];
  /** Return plain driver rows instead of hydrated documents. */
  readonly lean: boolean;
  /** `.plain()`: lean rows returned in their plain form (with `lean`). */
  readonly plain?: PlainReadOptions;
  /** No document is an error. */
  readonly orFail: boolean;
  /** The options shared by all operations. */
  readonly options: PlanOptions;
}

declare const MODEL: unique symbol;

/**
 * What `merge()` accepts: a query of the SAME model (the brand is invariant in `T`; M10 #5).
 *
 * @typeParam T - The entity type of the model.
 * @example
 * const other: QueryOf<User> = Users.find().where({ age: 1 }); // a query of another model does not fit
 */
export interface QueryOf<T> {
  /** Phantom: the model of the query, invariant. */
  readonly [MODEL]?: (entity: T) => T;
  /** The combined filter of the query. */
  readonly filter: () => PlanDocument;
  /** The entity class of the query's model. */
  readonly entity: EntityClass;
}

/*
 * Methods for some operations only: a conditional parameter type, or a `this` that is `unknown` when
 * allowed and a message object otherwise. Never `this: QueryBuilder<…other op…>`: comparing two builder
 * types structurally instantiates the whole result automaton and hit TS2589.
 */

/**
 * The parameter of a `find`-only setting: `V`, or a readable error on another operation.
 *
 * @typeParam Op - The builder's operation.
 * @typeParam V - The parameter type on `find`.
 * @typeParam Name - The method name, for the message.
 * @example
 * type A = FindOnly<"find", number, "skip">; // number
 * type B = FindOnly<"findOneAndUpdate", number, "skip">; // PathError<"skip() applies to find()">
 */
type FindOnly<Op, V, Name extends string> = Op extends "find" ? V : PathError<`${Name}() applies to find()`>;

/**
 * The `this` of a method for the operations `Allowed`: `unknown`, otherwise a message the builder lacks.
 *
 * @typeParam Op - The builder's operation.
 * @typeParam Allowed - The operations the method exists for.
 * @typeParam Message - The error message text.
 * @example
 * type A = OnlyFor<"find", "find", "m">; // unknown
 * type B = OnlyFor<"find", "findOneAndUpdate", "m">; // PathError<"m">
 */
type OnlyFor<Op, Allowed, Message extends string> = [Op] extends [Allowed] ? unknown : PathError<Message>;

/**
 * The `this` of the methods of rows (`parse`, `expect`): `OnRows` for a lean or plain query, a message otherwise.
 *
 * @typeParam Form - The result form of the builder.
 * @typeParam OnRows - The `this` to use for lean or plain queries.
 * @typeParam Message - The error message text for a hydrated query.
 * @example
 * type A = RowsOnly<false, unknown, "m">; // PathError<"m"> (hydrated)
 * type B = RowsOnly<true, unknown, "m">; // unknown (lean)
 */
type RowsOnly<Form extends ReadForm, OnRows, Message extends string> = [Form] extends [false]
  ? PathError<Message>
  : OnRows;

/**
 * Adds a projection `P` to the current one `S` (`undefined` means none yet).
 *
 * @typeParam S - The current projection, or `undefined`.
 * @typeParam P - The projection to add.
 * @example
 * type A = MergeProjection<undefined, { name: 1 }>; // { name: 1 }
 * type B = MergeProjection<{ name: 1 }, { age: 1 }>; // { name: 1 } & { age: 1 }
 */
type MergeProjection<S, P> = [S] extends [undefined] ? P : S & P;

/**
 * The text score fields of a query (`textScore(name)`): the keys of the narrowing state the entity does not have.
 *
 * @typeParam T - The entity type.
 * @typeParam N - The narrowing state.
 * @example
 * type A = ScoreKeys<{ title: string }, { readonly score: number }>; // "score"
 */
type ScoreKeys<T, N> = Exclude<keyof N & string, keyof T>;

/**
 * A projection without the text score fields: the score is projected by its `$meta`, so an inclusion that names it
 * is checked and merged without it.
 *
 * @typeParam P - The projection given to `select`.
 * @typeParam K - The text score fields.
 * @example
 * type A = WithoutScore<{ title: 1; score: 1 }, "score">; // { title: 1 }
 */
type WithoutScore<P, K extends string> = [K] extends [never] ? P : Omit<P, K>;

/**
 * A projection of unknown shape: any field may be left out, so the result has every field optional.
 *
 * @example
 * const wide: WideProjection = { name: true };
 */
type WideProjection = { readonly [path: string]: boolean };

/**
 * The projection a `select` adds: an argument typed `any` becomes a projection of unknown shape (the result
 * keeps every field, optional), never an `any` inside the result type.
 *
 * @typeParam P - The projection given to `select`.
 * @example
 * type A = AnyProjection<{ name: 1 }>; // { name: 1 }
 */
type AnyProjection<P> = IsAny<P> extends true ? WideProjection : P;

/**
 * Whether the operation returns many documents (`find`) or at most one.
 *
 * @typeParam Op - The operation.
 * @example
 * type A = Many<"find">; // true
 */
type Many<Op> = Op extends "find" ? true : false;

/**
 * The documents a query resolves to (the result automaton, `types/result.ts`): an array for `find`,
 * one document for find-and-modify, `null` added unless `orFail` or an upsert guarantees a match.
 *
 * @typeParam T - The entity type.
 * @typeParam Op - The operation.
 * @typeParam S - The projection.
 * @typeParam E - The populate entries.
 * @typeParam Form - The result form (hydrated, lean, plain).
 * @typeParam Found - Whether a match is guaranteed.
 * @typeParam N - The narrowing from `where(path)` chains.
 * @typeParam X - The excluded paths.
 * @example
 * type A = QueryOutput<User, "find", undefined, never, false, false, NoNarrowing, never>; // HydratedDoc<User>[]
 */
export type QueryOutput<
  T,
  Op extends FindOperation | ModifyOperation,
  S,
  E extends PopulationEntry,
  Form extends ReadForm,
  Found extends boolean,
  N,
  X extends string,
> = QueryResult<Many<Op>, Found, ResultDoc<T, S, E, Form, N, X>>;

/**
 * A hint: an index name or a key pattern over the paths of `T` (the schema's indexes are not visible to the type).
 *
 * @typeParam T - The entity type.
 * @example
 * const a: Hint<User> = "age_1";
 * const b: Hint<User> = { age: 1, name: -1 };
 */
export type Hint<T> = string | { readonly [P in FilterPaths<T>]?: 1 | -1 | "text" | "2dsphere" | "2d" | "hashed" };

/**
 * A query of documents of `T` (typed view; see the file comment). The type parameters carry the result
 * automaton: each method returns a builder whose parameters describe the new result.
 *
 * @typeParam T - The entity type.
 * @typeParam Op - The operation (`find` or a find-and-modify).
 * @typeParam S - The projection.
 * @typeParam E - The populate entries.
 * @typeParam Form - The result form: hydrated (`false`), lean, or plain.
 * @typeParam Found - Whether a match is guaranteed (`orFail`, upsert).
 * @typeParam N - The narrowing from `where(path)` chains.
 * @typeParam X - The excluded paths.
 *
 * Every type parameter is declared invariant (`in out`): two builders relate only when their parameters are
 * the same. Without the annotations the compiler compares two builders member by member, and a builder method
 * called inside another generic call (`expect(() => Users.find().select({ name: 1 }))`) then exceeds its
 * instantiation depth (TS2589).
 * @example
 * const q = Users.find().where({ age: { $gte: 18 } }).select({ name: 1 }).lean();
 * const rows = await q; // { _id: ObjectId; name: string }[]
 */
export interface QueryBuilder<
  in out T extends object,
  in out Op extends FindOperation | ModifyOperation,
  in out S = undefined,
  in out E extends PopulationEntry = never,
  in out Form extends ReadForm = false,
  in out Found extends boolean = false,
  in out N = NoNarrowing,
  in out X extends string = never,
> extends QueryOf<T> {
  /* conditions */
  /** Adds conditions (combined with the existing ones by AND). */
  where<F extends Filter<T, true>>(
    filter: F & NoInfer<FilterCheck<T, F>>,
  ): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** Starts a condition chain on one path: `.where("age").gte(18).lt(65)`. */
  where<const P extends FilterPaths<T>>(path: P): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, FilterValue<T, P>>;
  /** All of the clauses (`$and`, non-empty). */
  and<C extends NonEmptyArray<Filter<T, true>>>(
    clauses: C & NoInfer<FilterCheck<T, { $and: C }>>,
  ): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** At least one of the clauses (`$or`, non-empty). */
  or<C extends NonEmptyArray<Filter<T, true>>>(
    clauses: C & NoInfer<FilterCheck<T, { $or: C }>>,
  ): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** None of the clauses (`$nor`, non-empty). */
  nor<C extends NonEmptyArray<Filter<T, true>>>(
    clauses: C & NoInfer<FilterCheck<T, { $nor: C }>>,
  ): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** The conditions of another query of the SAME model (checked by type and at run time), or a filter. */
  merge(source: QueryOf<T>): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** The conditions of a filter (same as `where(filter)`). */
  merge<F extends Filter<T, true>>(
    source: F & NoInfer<FilterCheck<T, F>>,
  ): QueryBuilder<T, Op, S, E, Form, Found, N, X>;

  /* shape of the result */
  /*
   * The constraint is open (`& { readonly [key: string]: unknown }`) on purpose: a literal with a key the model does not
   * have still satisfies it, so `P` is inferred and the ONE readable check below reports the key ("projection
   * error": unknown field). Without the open part the compiler rejected such a literal against the constraint
   * itself: an excess-property error that printed the whole projection type on a model with `Hidden` fields and
   * the check's message on a model without them. The known keys keep their value types (a flag is 0/1/true/false).
   */
  /**
   * A projection (object form): an inclusion `{ name: 1 }` or an exclusion `{ bio: 0 }`, never
   * both; `{ "+passwordHash": true }` adds a `Hidden` field; arrays take `$slice`/`$elemMatch`.
   * Repeated calls merge.
   */
  select<const P extends Projection<T> & { readonly [key: string]: unknown }>(
    projection: P & ProjectionCheck<T, WithoutScore<P, ScoreKeys<T, N>>>,
  ): QueryBuilder<T, Op, MergeProjection<S, AnyProjection<WithoutScore<P, ScoreKeys<T, N>>>>, E, Form, Found, N, X>;
  /**
   * Adds the text-search score as field `name` (needs `$text` in the filter); `sort: true` also sorts by it (after the
   * keys of `sort()`). The field is then a known key of `sort()` (`.sort({ score: -1 })` sorts by the score, best match
   * first, in that position) and of `select()` (an inclusion keeps it).
   */
  textScore<const Name extends string = "score">(
    name?: Name,
    options?: { readonly sort?: boolean },
  ): QueryBuilder<T, Op, S, E, Form, Found, N & { readonly [K in Name]: number }, X>;
  /**
   * Populates: one path (checked segment by segment up to depth 7; the IDE offers depth ≤ 3), a list of paths and
   * objects (every element checked), or an object with options — `select`, `match` (a filter of the target or a
   * function of the document), `options`, nested `populate`, `justOne`, `retainNullValues`, `perDocumentLimit`,
   * and `transform`: `(doc, id) => value` — `doc` the lean populated document (`null` when not found), `id` the
   * reference's id; the field holds what it returns. The object's path is inferred first, so every option is typed
   * by its target.
   *
   * One signature serves the three forms (not overloads): a wrong argument is ONE compiler error whose text is
   * the message (`Invalid populate path "x": …`, a `populate error` property), not "No overload matches this call"
   * with the useful line inside one of the overloads. An argument typed `any` is a readable error in the result:
   * which paths it populates is unknown, so there is no guess. `IsAny` is tested inline, in the branches of the
   * signature's own conditional types: only the taken branch is computed, and computing the check or the result of
   * `any` inside another generic call (`expect(() => …)`) can exceed the instantiation depth.
   */
  populate<
    const Ps = never,
    const Pa extends PopulatePathHint<T> = never,
    const Sel = undefined,
    const O extends PopulateObjectSpec<T, Pa, Sel> = PopulateObjectSpec<T, Pa, Sel>,
    const L = never,
  >(
    arg: PopulateArgument<T, Ps, Pa, Sel, O, L>,
  ): IsAny<Ps> extends true
    ? PathError<"populate(): the argument is typed any; give it a type (a path literal, a list of paths or a populate object)">
    : QueryBuilder<T, Op, S, ReplaceEntries<E, PopulateArgumentEntries<Ps, Pa, O, L>>, Form, Found, N, X>;
  /** The driver's rows instead of hydrated documents (`ObjectId`, `bigint`, `Date` as they are; Maps as records). */
  lean(): QueryBuilder<T, Op, S, E, true, Found, N, X>;
  /**
   * The rows in their PLAIN form, without hydration — what `$toPlain()` of the hydrated document would
   * return: ids, int64, `Decimal128`, `UUID` as strings; `Date`, `RegExp` kept; bytes as `Uint8Array`; a vector as
   * `number[]`; Map fields as `Map`s; populated documents plain too. `Hidden` fields a query selected are left out
   * unless `{ hidden: true }`. The type follows select, populate and discriminators as for `lean()`.
   */
  plain(): QueryBuilder<T, Op, S, E, "plain", Found, N, X>;
  /** The plain rows with options: `{ hidden: true }` keeps the `Hidden` fields the query selected (`+field`). */
  plain<const O extends PlainReadOptions>(
    options: O,
  ): QueryBuilder<T, Op, S, E, O extends { readonly hidden: true } ? "plain+hidden" : "plain", Found, N, X>;
  /**
   * No document is an error (`DocumentNotFoundError`): the result type of `findOne`/`findById` loses `null`; for `find`
   * an empty list is the error (with `await`; a cursor streams batches and never fails on an empty one).
   */
  orFail(): QueryBuilder<T, Op, S, E, Form, true, N, X>;

  /* order and window */
  /** Sort (object or list of pairs, directions `1`/`-1`); repeated calls append keys. */
  sort(sort: Sort<T, ScoreKeys<T, N>>): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** Skips `n` documents (`find` only). */
  skip(n: FindOnly<Op, number, "skip">): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** At most `n` documents, `n > 0` (`find` only). */
  limit(n: FindOnly<Op, number, "limit">): QueryBuilder<T, Op, S, E, Form, Found, N, X>;

  /* options */
  /** Runs in this session (a transaction); `null` runs outside the ambient transaction. */
  session(session: ClientSession | null): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** The policy context of this operation (tenant, actor, soft delete view), over the ambient one. */
  policy(values: PolicyValues): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** Forces an index. */
  hint(hint: Hint<T>): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** String comparison rules. */
  collation(collation: CollationOptions): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** A comment for the profiler and the logs. */
  comment(comment: string): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** Client-side operation timeout (driver CSOT; replaces `maxTimeMS`). */
  timeoutMS(ms: number): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /**
   * Documents per batch of the cursor (`find` only): a positive integer. `0` is a `QueryError` (the driver would
   * read it as "the server default"); leave the setting out for the default.
   */
  batchSize(n: FindOnly<Op, number, "batchSize">): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** Read preference of this query. */
  readPreference(mode: ReadPreferenceMode): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** Read concern (inside a transaction the transaction's applies; a conflicting one is refused). */
  readConcern(level: ReadConcernLevel): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /** Lets the server spill large sorts to disk (`find` only). */
  allowDiskUse(allow: FindOnly<Op, boolean, "allowDiskUse">): QueryBuilder<T, Op, S, E, Form, Found, N, X>;
  /**
   * Strict reading for this query: `true` (the default argument) checks every document it reads — populated ones
   * too — against the schema before it becomes a result, `false` does not, whatever the client's `validateReads`
   * says. A stored value of another type, or a `null` on a path that is not nullable, is a `CastError` with its
   * path.
   */
  validateReads(enabled?: boolean): QueryBuilder<T, Op, S, E, Form, Found, N, X>;

  /* contracts */
  /**
   * Validates every row by a Standard Schema (zod, valibot, arktype, a model's `~standard`): the query resolves to
   * the schema's output (per row; `null` for "not found" stays `null`), any issue is a `ValidationError` (the path starts
   * with the row's index for `find`). Async schemas are awaited. Lean queries only: a hydrated document is not plain
   * data (a compile error says so). The parsed query is terminal: `await`/`exec`, `cursor()` for `find`, `expect`.
   */
  parse<Sch extends AnyStandardSchema>(
    this: RowsOnly<Form, unknown, "parse() validates rows: call .lean() or .plain() before .parse(schema)">,
    schema: Sch,
  ): ParsedQuery<QueryResult<Many<Op>, Found, StandardSchemaOutput<Sch>>, StandardSchemaOutput<Sch>, Many<Op>>;
  /**
   * The exact contract check, types only, no runtime cost: this same query when one row is EXACTLY `Shape`
   * (`Selected<…>` or any type), otherwise a compile error that names what is `missing`, `extra` (always an error) or a
   * `Selected<…>` or any type), otherwise a compile error that names what is `missing`, `extra` (always an error) or a
   * `mismatch`. Lean and plain queries only (a contract describes data).
   */
  expect<Shape>(
    this: RowsOnly<
      Form,
      ExpectRows<ResultDoc<T, S, E, Form, N, X>, Shape>,
      "expect<Shape>() checks rows: call .plain() or .lean() first (for a document, Contract.check its $toPlain())"
    >,
  ): QueryBuilder<T, Op, S, E, Form, Found, N, X>;

  /* response masks */
  /**
   * Masks the result for the caller: keys are typed paths of a row (nested, array elements, Map `$*`, populated),
   * values `"mask"` (→ `"?"`) or a mask function (`Mask.*`). Lean and plain queries only: a hydrated document with
   * masked values could be saved over the real data. Hooks, events and audit see the real data.
   */
  mask<const Sp extends object>(
    this: RowsOnly<
      Form,
      unknown,
      "mask() masks rows: call .lean() or .plain() first — a hydrated document with masked values could be saved"
    >,
    spec: Sp & MaskSpecCheck<ResultDoc<T, S, E, Form, N, X>, Sp>,
  ): MaskedQuery<
    QueryResult<Many<Op>, Found, ApplyMask<ResultDoc<T, S, E, Form, N, X>, Sp>>,
    ApplyMask<ResultDoc<T, S, E, Form, N, X>, Sp>,
    Many<Op>
  >;

  /* plan and execution */
  /** The immutable plan of this query. */
  build(): FindPlan | ModifyPlan;
  /**
   * Runs the query: a read once per builder (later calls return the same result), a write once;
   * `{ force: true }` runs it again — a read refreshes the cached result, a write is sent again.
   */
  exec(options?: ExecOptions): Promise<QueryOutput<T, Op, S, E, Form, Found, N, X>>;
  /** `await query`: the standard generic `Promise#then` (no `Promise<any>`). */
  then<R1 = QueryOutput<T, Op, S, E, Form, Found, N, X>, R2 = never>(
    onfulfilled?: ((value: QueryOutput<T, Op, S, E, Form, Found, N, X>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2>;
  /** Attaches a rejection handler (runs the query). */
  catch<R = never>(
    onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
  ): Promise<QueryOutput<T, Op, S, E, Form, Found, N, X> | R>;
  /** Attaches a completion handler (runs the query). */
  finally(onfinally?: (() => void) | null): Promise<QueryOutput<T, Op, S, E, Form, Found, N, X>>;
  /**
   * `"TypemoQuery"`, the tag `Object.prototype.toString` prints. With `then`, `catch` and `finally` it completes the
   * `Promise` interface: a query can be returned where a `Promise` of its result is expected
   * (`(id): Promise<HydratedDoc<User>> => Users.findById(id).orFail()`).
   */
  readonly [Symbol.toStringTag]: string;
  /** Streams the documents (`find` only); the same pipeline as `await` (one execution path). */
  cursor(this: OnlyFor<Op, "find", "cursor() applies to find()">): QueryCursor<ResultDoc<T, S, E, Form, N, X>>;
  /** The server's query plan instead of documents (`find`/`findOne`); an unknown `verbosity` is a `QueryError` before anything is sent. */
  explain(
    this: OnlyFor<Op, FindOperation, "explain() applies to find() and findOne()">,
    verbosity?: ExplainVerbosity,
  ): Promise<ExplainResult>;
  /** The driver's raw find-and-modify result (`value`, `lastErrorObject`, `ok`) instead of the document. */
  includeResultMetadata(
    this: OnlyFor<Op, ModifyOperation, "includeResultMetadata() applies to findOneAnd*()">,
  ): ExecutableQuery<ModifyResult<ResultDoc<T, S, E, Form, N, X>, IdOf<T>>>;
}

/*
 * where(path) chain: operand types
 */

/**
 * The non-null element type of an array type; `never` for a non-array.
 *
 * @typeParam V - The candidate array type.
 * @example
 * type A = ElementOf<string[]>; // string
 */
type ElementOf<V> = V extends readonly (infer E)[] ? NonNullable<E> : never;

/**
 * `true` when the value type may be an array.
 *
 * @typeParam V - The value type.
 * @example
 * type A = IsArrayValue<string[] | null>; // true
 * type B = IsArrayValue<string>; // false
 */
type IsArrayValue<V> = [Extract<NonNullable<V>, readonly unknown[]>] extends [never] ? false : true;

/**
 * The value a condition applies to: the element type for an array, the value itself otherwise (without `null`).
 *
 * @typeParam V - The value type.
 * @example
 * type A = Scalar<number[]>; // number
 * type B = Scalar<string | null>; // string
 */
type Scalar<V> = IsArrayValue<V> extends true ? ElementOf<NonNullable<V>> : NonNullable<V>;

/**
 * A value compared with the field: its stored form, `null` only on a nullable path; for an array also an element.
 *
 * @typeParam V - The value type at the path.
 * @example
 * type A = WhereOperand<string | null>; // string | null
 * type B = WhereOperand<number[]>; // number | readonly number[]
 */
export type WhereOperand<V> =
  IsArrayValue<V> extends true
    ? CompareOf<ElementOf<NonNullable<V>>> | readonly CompareOf<ElementOf<NonNullable<V>>>[] | Extract<V, null>
    : CompareOf<NonNullable<V>> | Extract<V, null>;

/**
 * The operand of `gt`/`gte`/`lt`/`lte`: an ordered value, or a readable error when the field has no order.
 *
 * @typeParam V - The value type at the path.
 * @example
 * type A = OrderOperand<number>; // number
 * type B = OrderOperand<boolean>; // PathError<"this field has no order: ...">
 */
type OrderOperand<V> = [Extract<Scalar<V>, Orderable>] extends [never]
  ? PathError<"this field has no order: $gt/$gte/$lt/$lte apply to numbers, strings, dates, ids">
  : CompareOf<Extract<Scalar<V>, Orderable>>;

/**
 * The operand of `regex`: a pattern for string fields, a readable error otherwise.
 *
 * @typeParam V - The value type at the path.
 * @example
 * type A = StringOperand<string>; // RegExp | string
 * type B = StringOperand<number>; // PathError<"$regex applies to string fields">
 */
type StringOperand<V> = [Extract<Scalar<V>, string>] extends [never]
  ? PathError<"$regex applies to string fields">
  : RegExp | string;

/**
 * The operand of an array-only method: `R` for an array field, a readable error otherwise.
 *
 * @typeParam V - The value type at the path.
 * @typeParam R - The operand type for an array field.
 * @example
 * type A = ArrayOperand<string[], number>; // number
 * type B = ArrayOperand<string, number>; // PathError<"$size/$all/$elemMatch apply to array fields">
 */
type ArrayOperand<V, R> = IsArrayValue<V> extends true ? R : PathError<"$size/$all/$elemMatch apply to array fields">;

/**
 * The operand of `mod`: a number for numeric fields, a readable error otherwise.
 *
 * @typeParam V - The value type at the path.
 * @example
 * type A = ModOperand<number>; // number
 * type B = ModOperand<string>; // PathError<"$mod applies to number fields">
 */
type ModOperand<V> = [Extract<Scalar<V>, number | bigint>] extends [never]
  ? PathError<"$mod applies to number fields">
  : number;

/**
 * The condition chain of `where(path)` (typed view): operators typed by the field's value `V`.
 * Conditions on one path accumulate in one operator object (`{ age: { $gte: 18, $lt: 65 } }`);
 * `equals`, `in`, `ne`, `nin`, `exists` narrow the result type (`types/narrow.ts`). Every other
 * method leaves the chain and returns a plain `QueryBuilder`. There are no geo helpers: use `where({…})`.
 *
 * @typeParam T - The entity type.
 * @typeParam Op - The operation.
 * @typeParam S - The projection.
 * @typeParam E - The populate entries.
 * @typeParam Form - The result form.
 * @typeParam Found - Whether a match is guaranteed.
 * @typeParam N - The narrowing so far.
 * @typeParam X - The excluded paths.
 * @typeParam P - The path of the chain.
 * @typeParam V - The value type at the path.
 * @example
 * const adults = await Users.find().where("age").gte(18).lt(65); // { age: { $gte: 18, $lt: 65 } }
 */
export interface WhereBuilder<
  T extends object,
  Op extends FindOperation | ModifyOperation,
  S,
  E extends PopulationEntry,
  Form extends ReadForm,
  Found extends boolean,
  N,
  X extends string,
  P extends string,
  V,
> extends QueryBuilder<T, Op, S, E, Form, Found, N, X> {
  /** The field equals `value` (narrows a finite field). */
  equals<const Y extends WhereOperand<V>>(
    value: Y,
  ): WhereBuilder<T, Op, S, E, Form, Found, NarrowIn<N, T, P, Y>, X, P, V>;
  /** The field differs from `value` (narrows a finite field). */
  ne<const Y extends WhereOperand<V>>(
    value: Y,
  ): WhereBuilder<T, Op, S, E, Form, Found, NarrowNotIn<N, T, P, Y>, X, P, V>;
  /** The field is one of `values` (narrows a finite field). */
  in<const Y extends readonly WhereOperand<V>[]>(
    values: Y,
  ): WhereBuilder<T, Op, S, E, Form, Found, NarrowIn<N, T, P, Y[number]>, X, P, V>;
  /** The field is none of `values` (narrows a finite field). */
  nin<const Y extends readonly WhereOperand<V>[]>(
    values: Y,
  ): WhereBuilder<T, Op, S, E, Form, Found, NarrowNotIn<N, T, P, Y[number]>, X, P, V>;
  /** Greater than. */
  gt(value: OrderOperand<V>): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
  /** Greater than or equal. */
  gte(value: OrderOperand<V>): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
  /** Less than. */
  lt(value: OrderOperand<V>): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
  /** Less than or equal. */
  lte(value: OrderOperand<V>): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
  /** The field exists (narrows: removes `undefined` only — a `null` value exists). */
  exists(): WhereBuilder<T, Op, S, E, Form, Found, N, NarrowExists<X, P>, P, V>;
  /** The field exists (`true`, narrows) or does not (`false`). */
  exists<const B extends boolean>(
    present: B,
  ): B extends true
    ? WhereBuilder<T, Op, S, E, Form, Found, N, NarrowExists<X, P>, P, V>
    : WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
  /** Matches a regular expression (string fields). */
  regex(pattern: StringOperand<V>): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
  /** `field % divisor === remainder` (number fields). */
  mod(divisor: ModOperand<V>, remainder: ModOperand<V>): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
  /** The array has exactly `n` elements. */
  size(n: ArrayOperand<V, number>): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
  /** The array contains all of `values`. */
  all(
    values: ArrayOperand<V, readonly CompareOf<ElementOf<NonNullable<V>>>[]>,
  ): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
  /** An element matches the condition (a filter of an embedded element, operators of a scalar one). */
  elemMatch(
    condition: ArrayOperand<V, ElemMatchOperand<ElementOf<NonNullable<V>>>>,
  ): WhereBuilder<T, Op, S, E, Form, Found, N, X, P, V>;
}

/**
 * The documents a query `Q` resolves to.
 *
 * @typeParam Q - A query (any thenable).
 * @example
 * type A = ResultOf<Promise<number>>; // number
 */
export type ResultOf<Q> = Q extends PromiseLike<infer R> ? R : never;

/*
 * runtime
 */

const asRecord = (value: unknown, what: string): Readonly<Record<string, unknown>> => {
  if (!BsonGuards.isPlainObject(value)) throw new QueryError(`${what}: an object`);
  return value;
};

const clause = (filter: unknown, what: string): PlanDocument => PlanValues.filter(asRecord(filter, what), what);

/** The runtime of {@link QueryBuilder}: builds plans, nothing else. */
class QueryRuntime {
  protected readonly state: QueryState;
  /* A read runs once per builder object (memoized), a find-and-modify (a write) runs once. */
  readonly #once = new ExecutionOnce();

  constructor(state: QueryState) {
    this.state = Object.freeze({ ...state });
  }

  get entity(): EntityClass {
    return this.state.entity;
  }

  filter(): PlanDocument {
    return PlanValues.combine(this.state.clauses);
  }

  protected derive(changes: Partial<QueryState>): QueryRuntime {
    const { whereClause: _chain, ...rest } = this.state;
    return new QueryRuntime({ ...rest, ...changes });
  }

  private withOption(options: Partial<PlanOptions>): QueryRuntime {
    return this.derive({ options: Object.freeze({ ...this.state.options, ...options }) });
  }

  where(arg: unknown): QueryRuntime {
    if (typeof arg === "string") {
      if (arg === "") throw new QueryError("where: an empty path");
      const { whereClause: _chain, ...rest } = this.state;
      return new WhereRuntime(rest, arg);
    }
    return this.derive({ clauses: [...this.state.clauses, clause(arg, "filter")] });
  }

  and(clauses: unknown): QueryRuntime {
    return this.derive({ clauses: [...this.state.clauses, clause({ $and: clauses }, "and")] });
  }

  or(clauses: unknown): QueryRuntime {
    return this.derive({ clauses: [...this.state.clauses, clause({ $or: clauses }, "or")] });
  }

  nor(clauses: unknown): QueryRuntime {
    return this.derive({ clauses: [...this.state.clauses, clause({ $nor: clauses }, "nor")] });
  }

  merge(source: unknown): QueryRuntime {
    if (source instanceof QueryRuntime) {
      if (source.entity !== this.state.entity) {
        throw new QueryError(
          `merge: a query of ${source.entity.name} cannot be merged into a query of ${this.state.entity.name}`,
        );
      }
      return this.derive({ clauses: [...this.state.clauses, source.filter()] });
    }
    return this.derive({ clauses: [...this.state.clauses, clause(source, "merge")] });
  }

  select(projection: unknown): QueryRuntime {
    const next = ProjectionPlanner.check(asRecord(projection, "select"));
    return this.derive({ projection: ProjectionPlanner.merge(this.state.projection, next) });
  }

  textScore(name?: string, options?: { readonly sort?: boolean }): QueryRuntime {
    const field = name ?? "score";
    if (field === "" || field.includes(".") || field.startsWith("$"))
      throw new QueryError(`textScore: invalid field name "${field}"`);
    QueryRuntime.checkScoreSort(this.state.sort, field);
    return this.derive({ textScore: Object.freeze({ name: field, sort: options?.sort === true }) });
  }

  populate(spec: unknown): QueryRuntime {
    return this.derive({ populate: PopulateSpecs.replace(this.state.populate, PopulateSpecs.normalize(spec)) });
  }

  lean(): QueryRuntime {
    const { plain: _plain, ...rest } = this.state;
    return new QueryRuntime({ ...rest, lean: true });
  }

  plain(options?: PlainReadOptions): QueryRuntime {
    if (options !== undefined && (typeof options !== "object" || options === null)) {
      throw new QueryError("plain: options are an object ({ hidden?: boolean })");
    }
    for (const key of Object.keys(options ?? {})) {
      if (key !== "hidden") throw new QueryError(`plain: "${key}" is not an option (only "hidden")`);
    }
    return this.derive({ lean: true, plain: Object.freeze({ hidden: options?.hidden === true }) });
  }

  orFail(): QueryRuntime {
    return this.derive({ orFail: true });
  }

  sort(sort: unknown): QueryRuntime {
    const pairs = QuerySpecs.appendSort(this.state.sort, QuerySpecs.sort(sort));
    if (this.state.textScore !== undefined) QueryRuntime.checkScoreSort(pairs, this.state.textScore.name);
    return this.derive({ sort: pairs });
  }

  /**
   * Refuses an ascending sort of the text score field.
   *
   * @param sort - The sort pairs.
   * @param name - The text score field.
   * @throws {QueryError} When the sort names the score with direction `1`: the server orders a text score from the
   *   best match only.
   */
  private static checkScoreSort(sort: readonly SortPair[] | undefined, name: string): void {
    if (!(sort ?? []).some(([path, direction]) => path === name && direction === 1)) return;
    throw new QueryError(
      `sort: "${name}" is the text score, which sorts from the best match only: use -1 (or textScore("${name}", { sort: true }))`,
      { path: name },
    );
  }

  private findOnly(what: string): void {
    if (this.state.op !== "find") throw new QueryError(`${what} applies to find() only, not ${this.state.op}()`);
  }

  skip(n: number): QueryRuntime {
    this.findOnly("skip");
    return this.derive({ skip: QuerySpecs.count("skip", n) });
  }

  limit(n: number): QueryRuntime {
    this.findOnly("limit");
    return this.derive({ limit: QuerySpecs.limit(n) });
  }

  session(session: ClientSession | null): QueryRuntime {
    return this.withOption({ session });
  }

  policy(values: PolicyValues): QueryRuntime {
    return this.withOption({
      policy: PolicyContext.merge(this.state.options.policy, values, `${this.state.op}.policy`),
    });
  }

  hint(hint: unknown): QueryRuntime {
    return this.withOption({ hint: QuerySpecs.hint(hint) });
  }

  collation(collation: CollationOptions): QueryRuntime {
    return this.withOption({ collation: Object.freeze({ ...collation }) });
  }

  comment(comment: string): QueryRuntime {
    return this.withOption({ comment });
  }

  /**
   * @internal The same query, named after the method the user called (`findByIdAndUpdate` runs as
   * `findOneAndUpdate`): its errors name that method. Not part of the typed builder.
   *
   * @param method - The method the user called.
   * @returns The derived query.
   */
  calledAs(method: string): QueryRuntime {
    return this.withOption({ method });
  }

  timeoutMS(ms: number): QueryRuntime {
    return this.withOption({ timeoutMS: QuerySpecs.timeoutMS(ms) });
  }

  batchSize(n: number): QueryRuntime {
    this.findOnly("batchSize");
    return this.withOption({ batchSize: QuerySpecs.positive("batchSize", n) });
  }

  readPreference(mode: ReadPreferenceMode): QueryRuntime {
    return this.withOption({ readPreference: mode });
  }

  readConcern(level: ReadConcernLevel): QueryRuntime {
    return this.withOption({ readConcern: level });
  }

  allowDiskUse(allow: boolean): QueryRuntime {
    this.findOnly("allowDiskUse");
    return this.withOption({ allowDiskUse: allow });
  }

  validateReads(enabled = true): QueryRuntime {
    if (typeof enabled !== "boolean") throw new QueryError("validateReads: true or false");
    return this.withOption({ validateReads: enabled });
  }

  build(): FindPlan | ModifyPlan {
    return this.plan({ kind: "run" });
  }

  protected plan(input: FindPlan["mode"]): FindPlan | ModifyPlan {
    const mode = Object.freeze({ ...input });
    const state = this.state;
    const score = state.textScore;
    const projection =
      score === undefined
        ? state.projection
        : Object.freeze({ ...state.projection, [score.name]: Object.freeze({ $meta: "textScore" as const }) });
    const sort = score === undefined ? state.sort : QueryRuntime.scoreSort(state.sort, score);
    const common = {
      entity: state.entity,
      options: Object.freeze({ ...state.options }),
      filter: PlanValues.combine(state.clauses),
      ...(projection === undefined ? {} : { projection }),
      ...(sort === undefined ? {} : { sort }),
      populate: state.populate,
      lean: state.lean,
      ...(state.plain === undefined ? {} : { plain: state.plain }),
      orFail: state.orFail,
    };
    if (state.op === "find" || state.op === "findOne") {
      return Object.freeze({
        ...common,
        op: state.op,
        ...(state.skip === undefined ? {} : { skip: state.skip }),
        ...(state.limit === undefined ? {} : { limit: state.limit }),
        mode,
      });
    }
    return Object.freeze({
      ...common,
      op: state.op,
      ...(state.update === undefined ? {} : { update: state.update }),
      ...(state.replacement === undefined ? {} : { replacement: state.replacement }),
      ...(state.arrayFilters === undefined ? {} : { arrayFilters: state.arrayFilters }),
      upsert: state.upsert,
      returnDocument: state.returnDocument,
      includeResultMetadata: false,
    });
  }

  /**
   * The sort of a query with a text score: the score field is a known sort key — `.sort({ score: -1 })` sorts by
   * `{ $meta: "textScore" }` in its place — and `{ sort: true }` appends that key unless the sort names it already.
   *
   * @param sort - The sort pairs of the query.
   * @param score - The text score field and whether it sorts.
   * @returns The sort pairs sent.
   */
  private static scoreSort(
    sort: readonly SortPair[] | undefined,
    score: NonNullable<QueryState["textScore"]>,
  ): readonly SortPair[] | undefined {
    const meta = Object.freeze({ $meta: "textScore" as const });
    let named = false;
    const pairs = (sort ?? []).map((pair): SortPair => {
      if (pair[0] !== score.name) return pair;
      named = true;
      return Object.freeze([score.name, meta] as const);
    });
    if (score.sort && !named) pairs.push(Object.freeze([score.name, meta] as const));
    return sort === undefined && pairs.length === 0 ? undefined : Object.freeze(pairs);
  }

  exec(options?: ExecOptions): Promise<unknown> {
    return this.#once.run(
      this.state.op,
      () => this.state.executor.execute(this.build()),
      options,
      this.state.options.method ?? this.state.op,
    );
  }

  // biome-ignore lint/suspicious/noThenProperty: a query is deliberately awaitable.
  then(
    onfulfilled?: ((value: unknown) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch(onrejected?: ((reason: unknown) => unknown) | null): Promise<unknown> {
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<unknown> {
    return this.exec().finally(onfinally);
  }

  /**
   * The tag `Object.prototype.toString` prints; completes the `Promise` interface (see the typed view).
   *
   * @returns `"TypemoQuery"`.
   */
  get [Symbol.toStringTag](): string {
    return "TypemoQuery";
  }

  /**
   * A query is not iterable: `for await` over it would otherwise fail with the engine's own "not iterable"
   * `TypeError`, which does not say what to do. The typed view does not declare this member, so the compiler
   * still refuses `for await (… of Model.find())`; this is the answer for plain JavaScript.
   *
   * @returns Never.
   * @throws {QueryError} Always: iterate `.cursor()` of a `find()` instead.
   */
  [Symbol.asyncIterator](): never {
    throw new QueryError(
      `${this.state.op}(): a query is not iterable with "for await"; iterate its cursor instead: for await (const doc of Model.find(filter).cursor())`,
    );
  }

  cursor(): QueryCursor<unknown> {
    this.findOnly("cursor");
    return new TypedCursor(this.state.executor.cursor(this.plan({ kind: "cursor" }) as FindPlan));
  }

  explain(verbosity: ExplainVerbosity = "queryPlanner"): Promise<unknown> {
    if (this.state.op !== "find" && this.state.op !== "findOne") {
      throw new QueryError(`explain applies to find() and findOne(), not ${this.state.op}()`);
    }
    return this.state.executor.execute(
      this.plan({ kind: "explain", verbosity: QuerySpecs.explainVerbosity(verbosity) }),
    );
  }

  parse(schema: unknown): ParsedQuery<unknown, unknown, boolean> {
    /* The type refuses a hydrated query (a message `this`); a JS caller gets the same rule at run time. */
    if (!this.state.lean)
      throw new QueryError("parse() validates rows: call .lean() or .plain() before .parse(schema)");
    const many = this.state.op === "find";
    const executor = this.state.executor;
    const plan = this.build();
    return new ParsedQuery(
      {
        op: this.state.op,
        method: this.state.options.method ?? this.state.op,
        run: () => executor.execute(plan),
        ...(many ? { cursor: () => this.cursor() } : {}),
      },
      schema,
      many,
    );
  }

  expect(): this {
    return this;
  }

  mask(spec: unknown): MaskedQuery<unknown, unknown, boolean> {
    /* The type refuses a hydrated query (a message `this`); a JS caller gets the same rule at run time. */
    if (!this.state.lean)
      throw new QueryError(
        "mask() masks rows: call .lean() or .plain() first — a hydrated document with masked values could be saved",
      );
    /* There is no "sensitive" preset: only the listed paths are masked; hiding a field is `select`. */
    const tree = ResponseMask.compile(spec);
    /* Checked like `select` paths: a path the rows do not have would mask nothing. */
    const schema = this.state.executor.schema;
    if (schema !== undefined) ResponseMask.check(tree, schema, this.#extraFields());
    const many = this.state.op === "find";
    const executor = this.state.executor;
    const plan = this.build();
    return new MaskedQuery(
      {
        op: this.state.op,
        method: this.state.options.method ?? this.state.op,
        model: this.state.entity.name,
        run: () => executor.execute(plan),
        ...(many ? { cursor: () => this.cursor() } : {}),
      },
      tree,
    );
  }

  /**
   * The top-level fields the query adds to its rows: computed projections and the text score.
   *
   * @returns The field names.
   */
  #extraFields(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const [key, value] of Object.entries(this.state.projection ?? {})) {
      if (typeof value === "object" && value !== null) out.add(key.split(".")[0] ?? key);
    }
    if (this.state.textScore !== undefined) out.add(this.state.textScore.name);
    return out;
  }

  includeResultMetadata(): ExecutableQuery<unknown> {
    if (this.state.op === "find" || this.state.op === "findOne") {
      throw new QueryError(`includeResultMetadata applies to findOneAnd*(), not ${this.state.op}()`);
    }
    const plan = Object.freeze({ ...(this.plan({ kind: "run" }) as ModifyPlan), includeResultMetadata: true });
    return new ExecutableQuery(this.state.executor, plan);
  }
}

/** The runtime of {@link WhereBuilder}. */
class WhereRuntime extends QueryRuntime {
  readonly #path: string;

  constructor(state: QueryState, path: string) {
    super(state);
    this.#path = path;
  }

  private add(operator: string, value: unknown): WhereRuntime {
    const path = this.#path;
    const copied = PlanValues.copy(value, `${path}.${operator}`, "where");
    const current = this.state.whereClause;
    const clauses = [...this.state.clauses];
    const existing = current?.path === path ? clauses[current.index] : undefined;
    const operators = existing?.[path];
    if (current !== undefined && BsonGuards.isPlainObject(operators) && !(operator in operators)) {
      clauses[current.index] = Object.freeze({ [path]: Object.freeze({ ...operators, [operator]: copied }) });
      return new WhereRuntime({ ...this.state, clauses }, path);
    }
    clauses.push(Object.freeze({ [path]: Object.freeze({ [operator]: copied }) }));
    return new WhereRuntime(
      { ...this.state, clauses, whereClause: Object.freeze({ path, index: clauses.length - 1 }) },
      path,
    );
  }

  equals(value: unknown): WhereRuntime {
    return this.add("$eq", value);
  }

  ne(value: unknown): WhereRuntime {
    return this.add("$ne", value);
  }

  in(values: unknown): WhereRuntime {
    return this.add("$in", values);
  }

  nin(values: unknown): WhereRuntime {
    return this.add("$nin", values);
  }

  gt(value: unknown): WhereRuntime {
    return this.add("$gt", value);
  }

  gte(value: unknown): WhereRuntime {
    return this.add("$gte", value);
  }

  lt(value: unknown): WhereRuntime {
    return this.add("$lt", value);
  }

  lte(value: unknown): WhereRuntime {
    return this.add("$lte", value);
  }

  exists(present = true): WhereRuntime {
    return this.add("$exists", present);
  }

  regex(pattern: unknown): WhereRuntime {
    return this.add("$regex", pattern);
  }

  mod(divisor: unknown, remainder: unknown): WhereRuntime {
    return this.add("$mod", [divisor, remainder]);
  }

  size(n: unknown): WhereRuntime {
    return this.add("$size", n);
  }

  all(values: unknown): WhereRuntime {
    return this.add("$all", values);
  }

  elemMatch(condition: unknown): WhereRuntime {
    return this.add("$elemMatch", PlanValues.filter(asRecord(condition, "elemMatch"), "elemMatch"));
  }
}

/** The constructor view of {@link QueryBuilder}. */
export interface QueryBuilderConstructor {
  new <T extends object, Op extends FindOperation | ModifyOperation>(
    state: QueryState,
  ): QueryBuilder<T, Op, undefined, never, false, false, NoNarrowing, never>;
}

/** The query builder: the runtime class `QueryRuntime` seen through its typed view. */
export const QueryBuilder = QueryRuntime as unknown as QueryBuilderConstructor;

/** `true` for a query builder (either view). */
export const isQueryBuilder = (value: unknown): value is QueryOf<unknown> => value instanceof QueryRuntime;
