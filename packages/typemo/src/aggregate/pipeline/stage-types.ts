import type { OpaqueValue } from "../../bson/opaque-value.ts";
import type { ExprKind, ExprNode } from "../expressions/expr-node.ts";
import type { Nullify, Simplify, UnionToIntersection, UnwrapDeep } from "../expressions/expr-types.ts";
import type {
  ApplyDottedKeys,
  DottedKeys,
  NestedFromPath,
  OmitPath,
  PathAt,
  PathError,
  PlainKeys,
  SetPath,
} from "../types/path-types.ts";

/*
 * How each stage changes the document type. Every transform DISTRIBUTES over a union document (after `$unionWith`,
 * or a discriminated union): `Omit<A | B, K>` would keep only the common keys.
 */

/** A leaf for the unwrap of composite literals. */
type Leaf = OpaqueValue | string | number | boolean | bigint | null | undefined;

/**
 * `-readonly` map of `UnwrapDeep` over a record. A value that may be `undefined` is a
 * field the server leaves out (`$arrayElemAt` past the end, `$getField` of a missing field): the key
 * becomes optional instead of a required key holding `undefined` (shape test `operator-shape`).
 *
 * @typeParam R - The record of expressions.
 * @example
 * ```ts
 * type A = UnwrapRecord<{ a: ExprNode<number>; b: ExprNode<string | undefined> }>; // { a: number; b?: string }
 * ```
 */
export type UnwrapRecord<R> = OptionalUndefined<{ [K in keyof R]: UnwrapDeep<R[K]> }>;

/**
 * Keys whose value may be `undefined` become optional (without the `undefined`).
 *
 * @typeParam R - The record type.
 * @example
 * ```ts
 * type A = OptionalUndefined<{ a: number; b: string | undefined }>; // { a: number; b?: string }
 * ```
 */
export type OptionalUndefined<R> = Simplify<
  { -readonly [K in keyof R as undefined extends R[K] ? never : K]: R[K] } & {
    -readonly [K in keyof R as undefined extends R[K] ? K : never]?: Exclude<R[K], undefined>;
  }
>;

/**
 * The keys assigned `$$REMOVE` (`fn.remove()` / `Vars.REMOVE`): the field leaves the document.
 *
 * @typeParam F - The fields object of the stage.
 * @example
 * ```ts
 * type A = RemovedKeys<{ a: ExprNode<undefined>; b: ExprNode<number> }>; // "a"
 * ```
 */
type RemovedKeys<F> = { [K in keyof F]-?: [UnwrapDeep<F[K]>] extends [undefined] ? K : never }[keyof F];

/**
 * `$addFields` / `$set` / `$setWindowFields.output`: plain keys replace, dotted keys write inside embedded
 * documents.
 *
 * @typeParam T - The document type before the stage.
 * @typeParam F - The fields object of the stage.
 * @example
 * ```ts
 * type A = ApplyFields<{ a: number; b: string }, { a: ExprNode<string> }>; // { a: string; b: string }
 * type B = ApplyFields<{ a: { x: 1 } }, { "a.y": ExprNode<number> }>; // { a: { x: 1; y: number } }
 * ```
 */
export type ApplyFields<T, F> = T extends unknown
  ? Simplify<
      ApplyDottedKeys<
        Omit<T, Extract<PlainKeys<F>, keyof T>> & UnwrapRecord<Pick<F, Exclude<PlainKeys<F>, RemovedKeys<F>>>>,
        UnwrapRecord<Pick<F, DottedKeys<F>>>
      >
    >
  : never;

/* ---- $project ---- */

/**
 * An inclusion when any field other than `_id` is kept or computed; only `0`/`false` values make an exclusion.
 *
 * @typeParam P - The projection object.
 * @example
 * ```ts
 * type A = HasInclusion<{ a: 1 }>; // true
 * type B = HasInclusion<{ a: 0 }>; // false
 * ```
 */
type HasInclusion<P> = true extends {
  [K in keyof P]: K extends "_id" ? false : P[K] extends 0 | false ? false : true;
}[keyof P]
  ? true
  : false;

/**
 * `$project` cannot keep some fields and drop others (only `_id` may differ): the excluded ones are typed as an
 * error.
 *
 * @typeParam P - The projection object.
 * @example
 * ```ts
 * type A = MixedProjection<{ a: 1; b: 0 }>; // { b: PathError<"$project cannot keep some fields …"> }
 * type B = MixedProjection<{ a: 1; _id: 0 }>; // unknown
 * ```
 */
export type MixedProjection<P> =
  HasInclusion<P> extends true
    ? {
        [K in Exclude<
          { [Q in keyof P]: P[Q] extends 0 | false ? Q : never }[keyof P],
          "_id"
        >]: PathError<"$project cannot keep some fields and exclude others in one stage (only _id may be excluded)">;
      }
    : unknown;

/**
 * A bare number other than `0`/`1` in `$project` is an error here: write `fn.literal(n)` for a constant.
 *
 * @typeParam P - The projection object.
 * @example
 * ```ts
 * type A = ProjectNumbers<{ a: 1; n: 5 }>; // { n: PathError<"a number in $project other than 0/1: …"> }
 * ```
 */
export type ProjectNumbers<P> = {
  [K in keyof P as P[K] extends number
    ? P[K] extends 0 | 1
      ? never
      : K
    : never]: PathError<"a number in $project other than 0/1: write fn.literal(n) for a constant">;
};

/**
 * The type of one projected field: kept (`1`/`true`) gives the field's own type, an expression gives its value,
 * an exclusion gives `never`.
 *
 * @typeParam T - The document type.
 * @typeParam K - The projected key.
 * @typeParam V - The projection value.
 * @example
 * ```ts
 * type A = ProjectFieldValue<{ a: string }, "a", 1>; // string
 * type B = ProjectFieldValue<{ a: string }, "a", ExprNode<number>>; // number
 * type C = ProjectFieldValue<{ a: string }, "a", 0>; // never
 * ```
 */
type ProjectFieldValue<T, K extends PropertyKey, V> = V extends 0 | false
  ? never
  : V extends 1 | true
    ? K extends keyof T
      ? T[K] | (object extends Pick<T, K> ? undefined : never)
      : never
    : UnwrapDeep<V>;

/**
 * The result of the dotted keys of an inclusion projection: kept paths keep their type, computed ones are nested.
 *
 * @typeParam T - The document type.
 * @typeParam P - The projection object.
 * @example
 * ```ts
 * type A = DottedProjection<{ a: { b: number; c: string } }, { "a.b": 1 }>; // { a: { b: number } }
 * ```
 */
type DottedProjection<T, P> = UnionToIntersection<
  {
    [K in DottedKeys<P>]: P[K] extends 0 | false
      ? unknown
      : P[K] extends 1 | true
        ? KeptPath<T, K & string>
        : NestedFromPath<K & string, UnwrapDeep<P[K]>>;
  }[DottedKeys<P>]
>;

/**
 * A kept dotted path: nested objects holding only that path; an optional parent stays optional.
 *
 * @typeParam T - The document type.
 * @typeParam K - The dotted path.
 * @example
 * ```ts
 * type A = KeptPath<{ a: { b: number; c: string } }, "a.b">; // { a: { b: number } }
 * type B = KeptPath<{ a?: { b: number } }, "a.b">; // { a?: { b: number } }
 * ```
 */
type KeptPath<T, K extends string> = K extends `${infer H}.${infer R}`
  ? H extends keyof T
    ? object extends Pick<T, H>
      ? { [X in H]?: KeptInside<NonNullable<T[H]>, R> }
      : { [X in H]: KeptInside<NonNullable<T[H]>, R> | Extract<T[H], null> }
    : never
  : K extends keyof T
    ? { [X in K]: T[K] }
    : never;

/**
 * The kept path `R` inside a value: element by element for an array.
 *
 * @typeParam V - The value that contains the path.
 * @typeParam R - The remaining dotted path.
 * @example
 * ```ts
 * type A = KeptInside<{ b: number; c: string }[], "b">; // { b: number }[]
 * ```
 */
type KeptInside<V, R extends string> = V extends readonly (infer E)[] ? KeptInside<E, R>[] : Simplify<KeptPath<V, R>>;

/**
 * The result of an inclusion projection: the kept and computed plain keys, the dotted keys, and `_id` unless it
 * is excluded.
 *
 * @typeParam T - The document type.
 * @typeParam P - The projection object.
 * @example
 * ```ts
 * type A = ApplyIncludeProjection<{ _id: ObjectId; a: number; b: string }, { a: 1 }>; // { a: number; _id: ObjectId }
 * ```
 */
type ApplyIncludeProjection<T, P> = OptionalUndefined<{
  [K in keyof P as K extends DottedKeys<P>
    ? never
    : [ProjectFieldValue<T, K, P[K]>] extends [never]
      ? never
      : K]: ProjectFieldValue<T, K, P[K]>;
}> &
  DottedProjection<T, P> &
  (P extends { _id: 0 | false }
    ? unknown
    : "_id" extends keyof P
      ? unknown
      : T extends { _id: infer Id }
        ? { _id: Id }
        : unknown);

/**
 * Removes every excluded (dotted) path.
 *
 * @typeParam T - The document type.
 * @typeParam Paths - The union of paths to remove.
 * @example
 * ```ts
 * type A = ExcludeAll<{ a: 1; b: { c: 2; d: 3 } }, "a" | "b.c">; // { b: { d: 3 } }
 * ```
 */
type ExcludeAll<T, Paths extends string> = [Paths] extends [never]
  ? T
  : UnionToIntersection<Paths extends unknown ? (x: Paths) => void : never> extends (x: infer L extends string) => void
    ? ExcludeAll<OmitPath<T, L>, Exclude<Paths, L>>
    : T;

/**
 * `$project`'s result.
 *
 * @typeParam T - The document type before the stage.
 * @typeParam P - The projection object.
 * @example
 * ```ts
 * type A = ApplyProject<{ _id: ObjectId; a: number; b: string }, { a: 1; _id: 0 }>; // { a: number }
 * type B = ApplyProject<{ a: number; b: string }, { b: 0 }>; // { a: number }
 * ```
 */
export type ApplyProject<T, P> = T extends unknown
  ? Simplify<
      HasInclusion<P> extends true
        ? ApplyIncludeProjection<T, P>
        : ExcludeAll<T, Extract<{ [K in keyof P]: P[K] extends 0 | false ? K : never }[keyof P], string>>
    >
  : never;

/* ---- $group, $bucket, $bucketAuto, $sortByCount ---- */

/**
 * The value type of a key of a composite `_id`: a node gives its value, anything else itself.
 *
 * @typeParam X - The key's expression or literal.
 * @example
 * ```ts
 * type A = RawKeyValue<ExprNode<number>>; // number
 * type B = RawKeyValue<"a">; // "a"
 * ```
 */
type RawKeyValue<X> = X extends ExprNode<infer R, never> ? R : X;

/**
 * A member of a `$group` key as stored: missing in an array is `null`; a missing key of an object is left out.
 *
 * @typeParam V - The member expression or literal.
 * @example
 * ```ts
 * type A = GroupKeyMember<ExprNode<string | undefined>>; // string | null
 * ```
 */
type GroupKeyMember<V> =
  V extends ExprNode<infer R, never>
    ? Nullify<R>
    : V extends readonly unknown[]
      ? { -readonly [K in keyof V]: GroupKeyMember<V[K]> }
      : [V] extends [Leaf]
        ? V
        : V extends object
          ? GroupKeyObject<V>
          : V;

/**
 * An object member of a `$group` key: a key whose value may be missing is optional.
 *
 * @typeParam V - The object of key expressions.
 * @example
 * ```ts
 * type A = GroupKeyObject<{ a: ExprNode<number>; b: ExprNode<string | undefined> }>; // { a: number; b?: string }
 * ```
 */
type GroupKeyObject<V> = Simplify<
  { -readonly [K in keyof V as undefined extends RawKeyValue<V[K]> ? never : K]: GroupKeyMember<V[K]> } & {
    -readonly [K in keyof V as undefined extends RawKeyValue<V[K]> ? K : never]?: GroupKeyMember<
      Exclude<RawKeyValue<V[K]>, undefined>
    >;
  }
>;

/**
 * `true` when the key union has exactly one member.
 *
 * @typeParam K - The key union.
 * @example
 * ```ts
 * type A = IsSingleKey<"a">; // true
 * type B = IsSingleKey<"a" | "b">; // false
 * ```
 */
type IsSingleKey<K> = [K] extends [never] ? false : [K] extends [UnionToIntersection<K>] ? true : false;

/**
 * The `_id` of `$group`/`$sortByCount` (a single missing value is `null`; a composite object omits missing keys).
 *
 * @typeParam V - The `_id` expression or literal.
 * @example
 * ```ts
 * type A = GroupId<ExprNode<string | undefined>>; // string | null
 * type B = GroupId<{ year: ExprNode<number>; kind: ExprNode<string> }>; // { year: number; kind: string }
 * ```
 */
export type GroupId<V> =
  V extends ExprNode<infer R, never>
    ? Nullify<R>
    : V extends readonly unknown[]
      ? { -readonly [K in keyof V]: GroupKeyMember<V[K]> }
      : [V] extends [Leaf]
        ? V
        : V extends object
          ? IsSingleKey<keyof V> extends true
            ? { -readonly [K in keyof V]: V[K] extends ExprNode<infer R, never> ? Nullify<R> : GroupKeyMember<V[K]> }
            : GroupKeyObject<V>
          : V;

/**
 * The problems of the spec of `$group` / `$bucket(Auto).output`: every value but `_id` must be an accumulator, and
 * `_id` an expression (a union of messages, `never` when there are none).
 *
 * @typeParam G - The stage spec.
 * @typeParam Stage - The stage name, used in the message.
 * @example
 * ```ts
 * type Ok = AccumulatorProblems<{ _id: ExprNode<string>; n: ExprNode<number, "acc"> }, "$group">; // never
 * type Bad = AccumulatorProblems<{ _id: ExprNode<string>; n: ExprNode<number> }, "$group">; // the message about "n"
 * ```
 */
export type AccumulatorProblems<G, Stage extends string> = {
  [K in keyof G & string]: K extends "_id"
    ? G[K] extends ExprNode<unknown, never>
      ? G[K] extends ExprNode<unknown, "expr">
        ? never
        : `${Stage} _id must be an expression (an accumulator such as fn.sum cannot group)`
      : never
    : G[K] extends ExprNode<unknown, "acc">
      ? never
      : `${Stage} field "${K}" needs an accumulator (fn.sum, fn.avg, fn.push, fn.first, fn.count, ...)`;
}[keyof G & string];

/**
 * What the callback of `$group` / `$bucket(Auto).output` may return: the spec itself when every value is an
 * accumulator, otherwise `PathError` ALONE. The error then reads "Type '{…}' is not assignable to type
 * 'PathError<"$group field \"x\" needs an accumulator …">'" — the message first, not hidden in an intersection of the
 * value's type with the error (`Expr<number> & PathError<…>`), which is what an intersection per field gave. When the
 * `_id` is `any` (a misspelled field, already an error of its own) the check stays silent.
 *
 * @typeParam G - The stage spec.
 * @typeParam Stage - The stage name, used in the error message.
 * @example
 * ```ts
 * type Ok = AccumulatorCheck<{ _id: ExprNode<string>; n: ExprNode<number, "acc"> }, "$group">; // unchanged
 * type Bad = AccumulatorCheck<{ _id: ExprNode<string>; n: ExprNode<number> }, "$group">; // PathError<…>
 * ```
 */
export type AccumulatorCheck<G, Stage extends string> = [AccumulatorProblems<G, Stage>] extends [never]
  ? G
  : /* an `_id` of type `any` is a typo the compiler already reported (an unknown field): a second error would only confuse */
    0 extends 1 & (G extends { readonly _id: infer I } ? I : never)
    ? G
    : /*
       * The mapped type is written in place (an alias would be printed by its name): the error then shows the messages
       * themselves, not `PathError<AccumulatorProblems<…>>`.
       */
      PathError<{ [K in AccumulatorProblems<G, Stage> & string]: K }[AccumulatorProblems<G, Stage> & string]>;

/**
 * `$group`'s result.
 *
 * @typeParam G - The stage spec (`_id` plus accumulators).
 * @example
 * ```ts
 * type A = ApplyGroup<{ _id: ExprNode<string>; total: ExprNode<number, "acc"> }>; // { _id: string; total: number }
 * ```
 */
export type ApplyGroup<G> = Simplify<
  { _id: GroupId<G extends { _id: infer I } ? I : never> } & UnwrapRecord<Omit<G, "_id">>
>;

/**
 * `$bucket`: `_id` is a lower boundary or the `default`; without `output` a `count`.
 *
 * @typeParam Boundary - The type of the boundaries.
 * @typeParam Output - The `output` accumulators.
 * @typeParam Default - The type of the `default` bucket id.
 * @example
 * ```ts
 * type A = ApplyBucket<number, {}, "other">; // { _id: number | "other"; count: number }
 * ```
 */
export type ApplyBucket<Boundary, Output, Default> = Simplify<
  { _id: Boundary | Default } & ([keyof Output] extends [never] ? { count: number } : UnwrapRecord<Output>)
>;

/**
 * `$bucketAuto`: `_id` is `{ min, max }`.
 *
 * @typeParam GroupBy - The type of the `groupBy` expression.
 * @typeParam Output - The `output` accumulators.
 * @example
 * ```ts
 * type A = ApplyBucketAuto<number, {}>; // { _id: { min: number; max: number }; count: number }
 * ```
 */
export type ApplyBucketAuto<GroupBy, Output> = Simplify<
  { _id: { min: GroupBy; max: GroupBy } } & ([keyof Output] extends [never] ? { count: number } : UnwrapRecord<Output>)
>;

/* ---- $setWindowFields ---- */

/**
 * Every `output` value must be a window function or an accumulator usable as one; one that needs an
 * order (`fn.rank()`, `fn.shift`, a bounded window) needs `sortBy` (`Sorted` is `false` without it), and one
 * that needs a single sort field (`fn.rank()`, `fn.denseRank()`, `fn.documentNumber()`, `fn.linearFill`) needs a
 * `sortBy` with exactly one key (`SortKeys` is the key union of `sortBy`).
 *
 * @typeParam O - The `output` object.
 * @typeParam Sorted - Whether the stage has a `sortBy`.
 * @typeParam SortKeys - The keys of the stage's `sortBy` (one key, or a union of several).
 * @example
 * ```ts
 * type Ok = WindowCheck<{ r: ExprNode<number, "window" | "needsSortBy"> }, true, "at">; // unchanged
 * type Bad = WindowCheck<{ r: ExprNode<number, "window" | "needsSortBy"> }, false>; // r: PathError<…>
 * type Two = WindowCheck<{ r: ExprNode<number, "window" | "needsSortBy" | "singleSortKey"> }, true, "a" | "b">; // r: PathError<…>
 * ```
 */
export type WindowCheck<O, Sorted extends boolean, SortKeys = never> = {
  [K in keyof O]: O[K] extends ExprNode<unknown, "window">
    ? Sorted extends true
      ? O[K] extends ExprNode<unknown, "singleSortKey">
        ? IsSingleKey<SortKeys> extends true
          ? O[K]
          : PathError<`$setWindowFields output "${K & string}" needs a sortBy with exactly one field (rank, denseRank, documentNumber and linearFill: a server rule)`>
        : O[K]
      : O[K] extends ExprNode<unknown, "needsSortBy">
        ? PathError<`$setWindowFields output "${K & string}" needs sortBy (rank, shift, derivative, integral, linearFill, expMovingAvg and bounded windows are ordered)`>
        : O[K]
    : O[K] extends ExprNode<unknown, "bounded">
      ? PathError<`$setWindowFields output "${K & string}" needs an explicit window: withWindow(fn.derivative(...), { range: [...] })`>
      : PathError<`$setWindowFields output "${K & string}" must be a window function or an accumulator (fn.sum, fn.rank, fn.shift, ...)`>;
};

/* ---- $unwind, $unset ---- */

/**
 * The field name of a `$path` string.
 *
 * @typeParam S - The `$`-prefixed path.
 * @example
 * ```ts
 * type A = FieldName<"$items">; // "items"
 * ```
 */
type FieldName<S> = S extends `$${infer F}` ? F : never;

/**
 * Replaces the array at `P` by its element type.
 *
 * @typeParam T - The document type.
 * @typeParam P - The path of the array.
 * @example
 * ```ts
 * type A = UnwindAt<{ tags: string[] }, "tags">; // { tags: string }
 * ```
 */
type UnwindAt<T, P extends string> = SetPath<T, P, NonNullable<PathAt<T, P>> extends readonly (infer E)[] ? E : never>;

/**
 * `$unwind`: the array field becomes one element; options add the index and keep empty arrays.
 *
 * @typeParam T - The document type before the stage.
 * @typeParam U - The `$unwind` argument: a `$path` string or an options object.
 * @example
 * ```ts
 * type A = ApplyUnwind<{ tags: string[] }, "$tags">; // { tags: string }
 * type B = ApplyUnwind<{ tags: string[] }, { path: "$tags"; includeArrayIndex: "i" }>; // { tags: string; i: bigint }
 * ```
 */
export type ApplyUnwind<T, U> = T extends unknown
  ? U extends string
    ? UnwindAt<T, FieldName<U>>
    : U extends { path: infer P extends string }
      ? WithIndex<Preserve<UnwindAt<T, FieldName<P>>, FieldName<P>, U>, U>
      : T
  : never;

/**
 * With `preserveNullAndEmptyArrays: true` an empty/missing array leaves the field out (or `null` stays `null`).
 *
 * @typeParam R - The document type after the unwind.
 * @typeParam K - The unwound field name.
 * @typeParam U - The `$unwind` options object.
 * @example
 * ```ts
 * type A = Preserve<{ tags: string }, "tags", { preserveNullAndEmptyArrays: true }>; // { tags?: string | null }
 * ```
 */
type Preserve<R, K extends string, U> = U extends { preserveNullAndEmptyArrays: true }
  ? K extends `${string}.${string}`
    ? R
    : K extends keyof R
      ? Simplify<Omit<R, K> & { [P in K]?: R[K] | null }>
      : R
  : R;

/**
 * Adds the `includeArrayIndex` field (an int64, `null` when empty arrays are preserved).
 *
 * @typeParam R - The document type after the unwind.
 * @typeParam U - The `$unwind` options object.
 * @example
 * ```ts
 * type A = WithIndex<{ a: 1 }, { includeArrayIndex: "i" }>; // { a: 1; i: bigint }
 * ```
 */
type WithIndex<R, U> = U extends { includeArrayIndex: infer I extends string }
  ? Simplify<R & { [P in I]: U extends { preserveNullAndEmptyArrays: true } ? bigint | null : bigint }>
  : R;

/**
 * `$unset` of one path or a list.
 *
 * @typeParam T - The document type before the stage.
 * @typeParam U - The path or the list of paths.
 * @example
 * ```ts
 * type A = ApplyUnset<{ a: 1; b: 2; c: 3 }, "a">; // { b: 2; c: 3 }
 * type B = ApplyUnset<{ a: 1; b: 2; c: 3 }, readonly ["a", "b"]>; // { c: 3 }
 * ```
 */
export type ApplyUnset<T, U> = T extends unknown
  ? U extends string
    ? OmitPath<T, U>
    : U extends readonly string[]
      ? ExcludeAll<T, U[number]>
      : T
  : never;

/* ---- $lookup, $graphLookup, $unionWith ---- */

/**
 * Sets `as` (a dotted `as` writes inside the embedded document).
 *
 * @typeParam T - The document type before the stage.
 * @typeParam As - The `as` path.
 * @typeParam Joined - The joined document type.
 * @example
 * ```ts
 * type A = ApplyLookup<{ a: 1 }, "orders", { total: number }>; // { a: 1; orders: { total: number }[] }
 * ```
 */
export type ApplyLookup<T, As extends string, Joined> = T extends unknown ? SetPath<T, As, Joined[]> : never;

/**
 * `$graphLookup`'s joined documents, with the `depthField` (an int64) when given.
 *
 * @typeParam J - The joined document type.
 * @typeParam Depth - The `depthField` name, or anything else when absent.
 * @example
 * ```ts
 * type A = WithDepth<{ name: string }, "depth">; // { name: string; depth: bigint }
 * type B = WithDepth<{ name: string }, undefined>; // { name: string }
 * ```
 */
export type WithDepth<J, Depth> = Depth extends string ? SetPath<J, Depth, bigint> : J;

/* ---- $fill, $densify, $geoNear ---- */

/**
 * `$fill`: a field filled with `value` is present afterwards; one filled by a `method` keeps its type.
 *
 * @typeParam T - The document type before the stage.
 * @typeParam Output - The `output` entries of the stage.
 * @example
 * ```ts
 * type A = ApplyFill<{ a?: number | null }, { a: { value: () => ExprNode<number> } }>; // { a: number }
 * ```
 */
export type ApplyFill<T, Output> = T extends unknown
  ? Simplify<
      Omit<T, FillValueKeys<Output> & keyof T> & {
        -readonly [K in FillValueKeys<Output>]: K extends keyof T
          ? Exclude<T[K], null | undefined> | FillValue<Output[K]>
          : FillValue<Output[K]>;
      }
    >
  : never;

/**
 * The keys of a `$fill` output that are filled by a `value`.
 *
 * @typeParam Output - The `output` entries of the stage.
 * @example
 * ```ts
 * type A = FillValueKeys<{ a: { value: () => 1 }; b: { method: "locf" } }>; // "a"
 * ```
 */
type FillValueKeys<Output> = { [K in keyof Output]-?: Output[K] extends { value: unknown } ? K : never }[keyof Output];

/**
 * The type a `$fill` `value` callback produces.
 *
 * @typeParam E - One `output` entry.
 * @example
 * ```ts
 * type A = FillValue<{ value: () => ExprNode<number> }>; // number
 * ```
 */
type FillValue<E> = E extends { value: (f: never) => infer V } ? UnwrapDeep<V> : never;

/**
 * `$densify`: new documents have only the densified field and the partition fields; other fields become optional.
 *
 * @typeParam T - The document type before the stage.
 * @typeParam F - The densified field.
 * @typeParam P - The partition fields.
 * @example
 * ```ts
 * type A = ApplyDensify<{ t: Date; k: string; v: number }, "t", "k">; // { t: Date; k: string } & { v?: number }
 * ```
 */
export type ApplyDensify<T, F extends string, P extends string> = T extends unknown
  ? Simplify<Pick<T, Extract<F | P, keyof T>> & Partial<Omit<T, F | P>>>
  : never;

/**
 * `$geoNear` adds `distanceField` (a number) and `includeLocs` (the matched location).
 *
 * @typeParam T - The document type before the stage.
 * @typeParam D - The `distanceField` path.
 * @typeParam L - The `includeLocs` path, or anything else when absent.
 * @example
 * ```ts
 * type A = ApplyGeoNear<{ name: string }, "dist", "loc">; // { name: string; dist: number; loc: GeoLocation }
 * ```
 */
export type ApplyGeoNear<T, D extends string, L> = T extends unknown
  ? L extends string
    ? SetPath<SetPath<T, D, number>, L, GeoLocation>
    : SetPath<T, D, number>
  : never;

/**
 * A location `includeLocs` may return: a GeoJSON point or a legacy coordinate pair.
 *
 * @example
 * ```ts
 * const a: GeoLocation = { type: "Point", coordinates: [13.4, 52.5] };
 * const b: GeoLocation = [13.4, 52.5];
 * ```
 */
export type GeoLocation = { type: "Point"; coordinates: [number, number] } | [number, number];

/**
 * Requires every node in the fields object to be a plain expression (an accumulator or window function is an
 * error); other values are kept.
 *
 * @typeParam F - The fields object.
 * @example
 * ```ts
 * type Ok = ExprValues<{ a: ExprNode<number> }>; // unchanged
 * type Bad = ExprValues<{ a: ExprNode<number, "acc"> }>; // a: PathError<…>
 * ```
 */
export type ExprValues<F> = {
  [K in keyof F]: F[K] extends ExprNode<unknown, never>
    ? F[K] extends ExprNode<unknown, "expr">
      ? F[K]
      : PathError<`field "${K & string}": an accumulator or window function is not an expression here`>
    : F[K];
};

/**
 * Distributive `Omit`.
 *
 * @typeParam T - The type (a union is handled member by member).
 * @typeParam K - The keys to remove.
 * @example
 * ```ts
 * type A = OmitEach<{ a: 1; k: 1 } | { b: 2; k: 2 }, "k">; // { a: 1 } | { b: 2 }
 * ```
 */
export type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * The kinds a node may have (re-export for stage signatures).
 *
 * @example
 * ```ts
 * const kind: AnyKind = "acc";
 * ```
 */
export type AnyKind = ExprKind;
