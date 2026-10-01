import type { IsPlainObject } from "../bson/opaque-value.ts";
import type { ElemMatchOperand } from "./filter.ts";
import type { IsHidden } from "./markers.ts";
import type { Paths, PathValue } from "./paths.ts";
import type { DataKeys } from "./schema-paths.ts";
import type { Simplify, UnionToIntersection } from "./type-utils.ts";

/*
 * Projection (`select`) and sort: object forms only, no string DSL.
 *
 * - A projection is an INCLUSION (`{ name: 1 }`: only these fields and `_id`) or an EXCLUSION
 *   (`{ passwordHash: 0 }`: everything else); mixing them (except `_id`) is a type error and a runtime
 *   error (the server refuses it, code 31254). Mongoose let the last one win silently.
 * - `Hidden<T>` fields (option `hidden: true`, Mongoose `select: false`) are left out by default, at
 *   any depth; `{ "+passwordHash": true }` adds one to the default set, an inclusion that names it
 *   includes it (Mongoose's types never knew about `select: false`).
 * - Array operators: `{ comments: { $slice: 5 } }` (keeps the other fields), `{ reactions: { $elemMatch:
 *   { kind: "love" } } }` (an inclusion). `$meta: "textScore"` is the query's `textScore()`.
 */

/**
 * An inclusion (`1`, `true`) or exclusion (`0`, `false`) flag.
 *
 * @example
 * const a: ProjectionFlag = 1;
 * const b: ProjectionFlag = false;
 */
export type ProjectionFlag = 0 | 1 | boolean;

/**
 * `$slice` of an array path: `n` first (`-n` last) elements, or `[skip, limit]`.
 *
 * @example
 * const a: SliceProjection = { $slice: 5 };
 * const b: SliceProjection = { $slice: [10, 5] };
 */
export interface SliceProjection {
  /** The count, or the `[skip, limit]` pair. */
  readonly $slice: number | readonly [skip: number, limit: number];
}

/**
 * `$elemMatch` of an array path: only the first matching element is returned.
 *
 * @typeParam E - The array element type.
 * @example
 * const a: ElemMatchProjection<{ kind: string }> = { $elemMatch: { kind: "love" } };
 */
export interface ElemMatchProjection<E> {
  /** The condition the returned element must match. */
  readonly $elemMatch: ElemMatchOperand<E>;
}

/**
 * The element type of an array value, `never` for a non-array.
 *
 * @typeParam V - The field type.
 * @example
 * type A = ArrayElementAt<string[] | null>; // string
 * type B = ArrayElementAt<string>; // never
 */
type ArrayElementAt<V> = NonNullable<V> extends readonly (infer E)[] ? NonNullable<E> : never;

/**
 * What a projection may hold for a path of value type `V`: a flag, and for an array also `$slice`/`$elemMatch`.
 *
 * @typeParam V - The path's value type.
 * @example
 * type A = ProjectionOperand<string>; // ProjectionFlag
 * type B = ProjectionOperand<string[]>; // ProjectionFlag | SliceProjection | ElemMatchProjection<string>
 */
type ProjectionOperand<V> = [ArrayElementAt<V>] extends [never]
  ? ProjectionFlag
  : ProjectionFlag | SliceProjection | ElemMatchProjection<ArrayElementAt<V>>;

/**
 * The dotted paths of `Hidden<T>` fields of `T` (at any depth up to the path ceiling: five segments, as `MaxPathDepth`).
 *
 * The levels are separate aliases instead of one alias with a depth counter on purpose: the compiler measures
 * the variance of an alias by comparing it with placeholder arguments, and a placeholder depth never reaches
 * `0`, so that comparison ran until the instantiation limit (TS2589 in generic helpers over change streams and
 * document forms).
 *
 * @typeParam T - The entity type.
 * @example
 * type A = HiddenPaths<{ name: string; auth: { hash: Hidden<string> } }>; // "auth.hash"
 */
export type HiddenPaths<T> = T extends unknown
  ? HiddenLevel<T, { [K in keyof T]: HiddenPaths4<SubDocOf<T[K]>> }>
  : never;

/**
 * Level 4 of {@link HiddenPaths} (four more segments at most).
 *
 * @typeParam T - The subdocument type.
 * @example
 * type A = HiddenPaths4<{ hash: Hidden<string> }>; // "hash"
 */
type HiddenPaths4<T> = T extends unknown ? HiddenLevel<T, { [K in keyof T]: HiddenPaths3<SubDocOf<T[K]>> }> : never;

/**
 * Level 3 of {@link HiddenPaths}.
 *
 * @typeParam T - The subdocument type.
 * @example
 * type A = HiddenPaths3<{ hash: Hidden<string> }>; // "hash"
 */
type HiddenPaths3<T> = T extends unknown ? HiddenLevel<T, { [K in keyof T]: HiddenPaths2<SubDocOf<T[K]>> }> : never;

/**
 * Level 2 of {@link HiddenPaths}.
 *
 * @typeParam T - The subdocument type.
 * @example
 * type A = HiddenPaths2<{ hash: Hidden<string> }>; // "hash"
 */
type HiddenPaths2<T> = T extends unknown ? HiddenLevel<T, { [K in keyof T]: HiddenPaths1<SubDocOf<T[K]>> }> : never;

/**
 * The last level of {@link HiddenPaths}: the hidden keys of `T` itself.
 *
 * @typeParam T - The subdocument type.
 * @example
 * type A = HiddenPaths1<{ hash: Hidden<string>; a: { b: Hidden<string> } }>; // "hash"
 */
type HiddenPaths1<T> = T extends unknown ? HiddenLevel<T, { [K in keyof T]: never }> : never;

/**
 * One level of {@link HiddenPaths}: the hidden keys of `T`, and every other key joined with its paths `Below`.
 *
 * @typeParam T - The document or subdocument type.
 * @typeParam Below - The hidden paths inside each key's value (computed by the next level).
 * @example
 * type A = HiddenLevel<{ hash: Hidden<string>; a: { b: Hidden<string> } }, { hash: never; a: "b" }>; // "hash" | "a.b"
 */
type HiddenLevel<T, Below> = {
  [K in DataKeys<T>]: IsHidden<T[K]> extends true ? K : JoinPath<K, Below[K & keyof Below]>;
}[DataKeys<T>];

/**
 * The embedded document a field holds (through `null` and nested arrays), `never` for any other value.
 *
 * @typeParam V - The field type.
 * @example
 * type A = SubDocOf<{ b: string }[] | null>; // { b: string }
 * type B = SubDocOf<string>; // never
 */
type SubDocOf<V> = true extends IsPlainObject<Elem<NonNullable<V>>> ? Extract<Elem<NonNullable<V>>, object> : never;

/**
 * The array element (through nested arrays), the value itself otherwise.
 *
 * @typeParam V - The field type.
 * @example
 * type A = Elem<string[][]>; // string
 */
type Elem<V> = V extends readonly (infer E)[] ? Elem<NonNullable<E>> : V;
/**
 * Joins a key and a sub-path with a dot.
 *
 * @typeParam K - The key.
 * @typeParam Sub - The sub-path union.
 * @example
 * type A = JoinPath<"a", "b">; // "a.b"
 */
type JoinPath<K extends string, Sub> = Sub extends string ? `${K}.${Sub}` : never;

/**
 * A projection of `T`: read paths with a flag (arrays also `$slice`/`$elemMatch`), `+hidden` additions.
 *
 * @typeParam T - The entity type.
 * @example
 * const a: Projection<User> = { name: 1 };
 * const b: Projection<User> = { passwordHash: 0 };
 * const c: Projection<User> = { "+passwordHash": true };
 */
export type Projection<T> = {
  readonly [P in Paths<T> | "_id"]?: P extends "_id" ? ProjectionFlag : ProjectionOperand<PathValue<T, P>>;
} & { readonly [P in `+${HiddenPaths<T>}`]?: true };

/**
 * The flag values that include a field.
 *
 * @example
 * const a: Truthy = true;
 */
type Truthy = 1 | true;
/**
 * The flag values that exclude a field.
 *
 * @example
 * const a: Falsy = 0;
 */
type Falsy = 0 | false;

/**
 * The keys of projection `S` that include a field (truthy flag or `$elemMatch`); `_id` and `+` keys do not count.
 *
 * @typeParam S - The projection literal type.
 * @example
 * type A = IncludedKeys<{ name: 1; age: 0 }>; // "name"
 */
type IncludedKeys<S> = {
  [K in keyof S]-?: K extends "_id" | `+${string}`
    ? never
    : S[K] extends Truthy | { readonly $elemMatch: unknown }
      ? K
      : never;
}[keyof S];
/**
 * The keys of projection `S` that exclude a field (falsy flag); `_id` and `+` keys do not count.
 *
 * @typeParam S - The projection literal type.
 * @example
 * type A = ExcludedKeys<{ name: 1; age: 0 }>; // "age"
 */
type ExcludedKeys<S> = {
  [K in keyof S]-?: K extends "_id" | `+${string}` ? never : S[K] extends Falsy ? K : never;
}[keyof S];
/**
 * The keys of projection `S` whose flag is not a literal (`boolean` or `0 | 1`).
 *
 * @typeParam S - The projection type.
 * @example
 * type A = WideKeys<{ name: boolean; age: 1 }>; // "name"
 */
type WideKeys<S> = { [K in keyof S]-?: boolean extends S[K] ? K : 0 | 1 extends S[K] ? K : never }[keyof S];
/**
 * The hidden paths a projection adds back with a `+path` key.
 *
 * @typeParam S - The projection literal type.
 * @example
 * type A = PlusKeys<{ "+passwordHash": true; name: 1 }>; // "passwordHash"
 */
type PlusKeys<S> = { [K in keyof S]-?: K extends `+${infer P}` ? P : never }[keyof S];
/**
 * The keys of projection `S` that use `$slice`.
 *
 * @typeParam S - The projection literal type.
 * @example
 * type A = SlicedKeys<{ comments: { $slice: 5 } }>; // "comments"
 */
type SlicedKeys<S> = { [K in keyof S]-?: S[K] extends SliceProjection ? K : never }[keyof S];
/**
 * `true` for a projection whose shape is not known exactly: a declared `Projection<T>` value (optional keys, flags
 * `0 | 1 | boolean`), a dynamic `Record<string, 0 | 1>` (an index signature) or any flag that is not a literal.
 * The result of such a projection has every field optional (nothing is known about which fields come back).
 *
 * @typeParam S - The projection type.
 * @example
 * type A = IsWideProjection<{ readonly name: 1 }>; // false (a literal)
 * type B = IsWideProjection<Projection<User>>; // true
 * type C = IsWideProjection<Record<string, 1>>; // true
 */
type IsWideProjection<S> = [
  { [K in keyof S]-?: Record<never, never> extends Pick<S, K> ? K : never }[keyof S] | WideKeys<S>,
] extends [never]
  ? false
  : true;

/**
 * `unknown` when the projection `S` of `T` is valid, otherwise a required property naming the problem
 * (an unknown field — a generic argument has no excess-property check —, inclusion mixed with exclusion).
 *
 * A projection whose shape is not known exactly is accepted and gives the widest result (every field optional):
 * a declared `Projection<T>` value, and a dynamic one (`Record<string, 0 | 1>`, `untrusted(fields)`) whose keys
 * the compiler cannot see — its paths and its mode are checked when the query runs (an unknown path is a
 * `StrictModeError`, a mixed projection a `QueryError`).
 *
 * @typeParam T - The entity type.
 * @typeParam S - The projection type.
 * @example
 * type A = ProjectionCheck<User, { name: 1 }>; // unknown
 * type B = ProjectionCheck<User, { nme: 1 }>; // { readonly "projection error": `unknown field "nme"` }
 * type C = ProjectionCheck<User, Record<string, 1>>; // unknown (checked at run time)
 */
export type ProjectionCheck<T, S> = string extends keyof S
  ? unknown
  : [Exclude<keyof S & string, keyof Projection<T>>] extends [never]
    ? IsWideProjection<S> extends true
      ? unknown
      : ProjectionModeCheck<S>
    : { readonly "projection error": `unknown field "${Exclude<keyof S & string, keyof Projection<T>>}"` };

/**
 * The mode part of {@link ProjectionCheck}: no inclusion mixed with exclusion, literal flags only.
 *
 * @typeParam S - The projection literal type.
 * @example
 * type A = ProjectionModeCheck<{ name: 1; age: 0 }>; // { readonly "projection error": `cannot mix inclusion ...` }
 * type B = ProjectionModeCheck<{ name: 1 }>; // unknown
 */
export type ProjectionModeCheck<S> = [WideKeys<S>] extends [never]
  ? [IncludedKeys<S>] extends [never]
    ? unknown
    : [ExcludedKeys<S>] extends [never]
      ? unknown
      : {
          readonly "projection error": `cannot mix inclusion ("${IncludedKeys<S> & string}") and exclusion ("${ExcludedKeys<S> & string}") in one projection`;
        }
  : { readonly "projection error": `the flag of "${WideKeys<S> & string}" must be a literal 0/1/true/false` };

/* ---- applying a projection to a document type ---- */

/**
 * The keys of `T` that are not stored data (methods and virtuals); a projection never removes them.
 *
 * @typeParam T - The entity type.
 * @example
 * class User { name!: string; save(): void {} }
 * type A = NonDataKeys<User>; // "save"
 */
type NonDataKeys<T> = Exclude<keyof T, DataKeys<T>>;

/**
 * `T` with the value at dotted path `P` removed (arrays: in every element).
 *
 * @typeParam T - The document type.
 * @typeParam P - The dotted path to remove.
 * @example
 * type A = OmitPath<{ name: string; auth: { hash: string; salt: string } }, "auth.hash">;
 * // { name: string; auth: { salt: string } }
 */
export type OmitPath<T, P extends string> = P extends `${infer H}.${infer R}`
  ? { [K in keyof T]: K extends H ? OmitInValue<T[K], R> : T[K] }
  : Omit<T, P>;

/**
 * Removes path `R` inside value `V` (through `null`, arrays and embedded documents).
 *
 * @typeParam V - The value type.
 * @typeParam R - The remaining path.
 * @example
 * type A = OmitInValue<{ a: 1; b: 2 }[] | null, "a">; // { b: 2 }[] | null
 */
type OmitInValue<V, R extends string> = V extends null | undefined
  ? V
  : V extends readonly (infer E)[]
    ? OmitInValue<E, R>[]
    : true extends IsPlainObject<V>
      ? Simplify<OmitPath<V, R>>
      : V;

/**
 * `T` without every path of `P` (top-level keys and dotted paths), in ONE pass: a union of partial omits
 * intersected would bring back what another member removed.
 *
 * @typeParam T - The document type.
 * @typeParam P - The paths to remove.
 * @example
 * type A = OmitPaths<{ a: 1; b: { c: 2; d: 3 } }, "a" | "b.c">; // { b: { d: 3 } }
 */
type OmitPaths<T, P extends string> = [P] extends [never]
  ? T
  : {
      [K in keyof T as K extends Exclude<P, `${string}.${string}`> ? never : K]: K extends string
        ? OmitBelow<T[K], SubPaths<P, K>>
        : T[K];
    };

/**
 * The parts of the paths `P` that lie below key `K`.
 *
 * @typeParam P - The paths.
 * @typeParam K - The key.
 * @example
 * type A = SubPaths<"b.c" | "a", "b">; // "c"
 */
type SubPaths<P extends string, K extends string> = P extends `${K}.${infer R}` ? R : never;

/**
 * Removes the paths `R` inside value `V` (through `null`, arrays and embedded documents).
 *
 * @typeParam V - The value type.
 * @typeParam R - The remaining paths.
 * @example
 * type A = OmitBelow<{ c: 2; d: 3 }[], "c">; // { d: 3 }[]
 */
type OmitBelow<V, R extends string> = [R] extends [never]
  ? V
  : V extends null | undefined
    ? V
    : V extends readonly (infer E)[]
      ? OmitBelow<E, R>[]
      : true extends IsPlainObject<V>
        ? OmitPaths<V, R>
        : V;

/**
 * The default view of `T`: every field except the `Hidden` ones (and except `Plus`, which are added back).
 *
 * @typeParam T - The entity type.
 * @typeParam Plus - The hidden paths added back with `+path`.
 * @example
 * type A = DefaultView<{ name: string; hash: Hidden<string> }>; // { name: string }
 * type B = DefaultView<{ name: string; hash: Hidden<string> }, "hash">; // { name: string; hash: Hidden<string> }
 */
export type DefaultView<T, Plus extends string = never> = [Exclude<HiddenPaths<T>, Plus>] extends [never]
  ? T
  : OmitPaths<T, Exclude<HiddenPaths<T>, Plus>>;

/**
 * Only the value at dotted path `P` of `T` (arrays: in every element; optionality kept).
 *
 * @typeParam T - The document type.
 * @typeParam P - The dotted path to keep.
 * @example
 * type A = PickPath<{ a: 1; b: { c: 2; d: 3 } }, "b.c">; // { b: { c: 2 } }
 */
type PickPath<T, P extends string> = P extends `${infer H}.${infer R}`
  ? { [K in keyof T as K extends H ? K : never]: PickInValue<T[K], R> }
  : { [K in keyof T as K extends P ? K : never]: T[K] };

/**
 * Keeps only path `R` inside value `V` (through `null`, arrays and embedded documents).
 *
 * @typeParam V - The value type.
 * @typeParam R - The remaining path.
 * @example
 * type A = PickInValue<{ c: 2; d: 3 }[], "c">; // { c: 2 }[]
 */
type PickInValue<V, R extends string> = V extends null | undefined
  ? V
  : V extends readonly (infer E)[]
    ? PickInValue<E, R>[]
    : true extends IsPlainObject<V>
      ? PickPath<V, R>
      : V;

/**
 * The result of an inclusion: the top-level keys `K`, every non-data key, and each dotted path of `K`.
 *
 * @typeParam T - The document type.
 * @typeParam K - The included keys and paths.
 * @example
 * type A = Included<{ a: 1; b: { c: 2; d: 3 } }, "a" | "b.c">; // { a: 1 } & { b: { c: 2 } }
 */
type Included<T, K extends string> = Pick<T, Extract<Exclude<K, `${string}.${string}`> | NonDataKeys<T>, keyof T>> &
  UnionToIntersection<
    Extract<K, `${string}.${string}`> extends infer D ? (D extends string ? PickPath<T, D> : never) : never
  >;

/**
 * `"_id"` when the projection removes `_id`, `never` otherwise.
 *
 * @typeParam S - The projection literal type.
 * @example
 * type A = IdOut<{ _id: 0 }>; // "_id"
 */
type IdOut<S> = S extends { readonly _id: Falsy } ? "_id" : never;
/**
 * The `_id` part of an inclusion result: kept unless the projection removes it.
 *
 * @typeParam T - The document type.
 * @typeParam S - The projection literal type.
 * @example
 * type A = IdPart<{ _id: ObjectId }, { name: 1 }>; // { _id: ObjectId }
 * type B = IdPart<{ _id: ObjectId }, { _id: 0 }>; // unknown
 */
type IdPart<T, S> = S extends { readonly _id: Falsy } ? unknown : Pick<T, Extract<"_id", keyof T>>;

/**
 * The document type after projection `S` (`undefined` = the default view). A projection whose shape is not
 * known exactly (flags that are not literals, optional keys, a dynamic `Record<string, 0 | 1>`) gives every field
 * optional (nothing is known), the `Hidden` fields it may add with `+path` included.
 *
 * @typeParam T - The entity type.
 * @typeParam S - The projection literal type, or `undefined`.
 * @example
 * type A = ApplyProjection<{ _id: ObjectId; name: string; age: number }, { name: 1 }>;
 * // { _id: ObjectId; name: string }
 * type B = ApplyProjection<{ _id: ObjectId; name: string; age: number }, { age: 0 }>;
 * // { _id: ObjectId; name: string }
 */
export type ApplyProjection<T, S> = [S] extends [undefined]
  ? DefaultView<T>
  : IsWideProjection<S> extends false
    ? [IncludedKeys<S>] extends [never]
      ? [ExcludedKeys<S>] extends [never]
        ? S extends { readonly _id: Truthy }
          ? /* `{ _id: 1 }` alone: only `_id` */ Pick<T, Extract<"_id", keyof T>>
          : OmitPaths<DefaultView<T, PlusKeys<S> & string>, IdOut<S>>
        : OmitPaths<DefaultView<T, PlusKeys<S> & string>, (ExcludedKeys<S> & string) | IdOut<S>>
      : Simplify<Included<T, (IncludedKeys<S> | PlusKeys<S> | SlicedKeys<S>) & string> & IdPart<T, S>>
    : Partial<DefaultView<T, PlusKeys<S> & string>>;

/**
 * `true` when one of the keys is a dotted path (the projection cannot be written with `Pick`/`Omit`).
 *
 * @typeParam K - The keys.
 * @example
 * type A = HasDotted<"a" | "b.c">; // true
 */
type HasDotted<K> = [Extract<K, `${string}.${string}`>] extends [never] ? false : true;

/**
 * The fields `K` of `T` an inclusion projection returns, with the class's methods, getters and virtuals (they are
 * not data: a projection does not remove them). The hover names only the included fields:
 * `HydratedDoc<Projected<User, "_id" | "name">>`.
 *
 * @typeParam T - The entity type.
 * @typeParam K - The included data keys.
 * @example
 * type A = Projected<User, "_id" | "name">; // Pick<User, "_id" | "name" | (methods and virtuals)>
 */
export type Projected<T, K extends keyof T> = Pick<T, K | NonDataKeys<T>>;

/**
 * The class part of a hydrated result of projection `S` (`undefined` = the default read), as the hover shows it:
 * the class itself, `Projected<T, …>` for an inclusion, `Omit<T, …>` for an exclusion, `Partial<T>` for a projection
 * whose shape is not known exactly. A projection with dotted paths has no such name: then it is the projected shape
 * itself. The document type rebuilds its fields from this part (the default view: `Hidden` fields out) and the
 * fields that differ ({@link KeptHiddenKeys}, populated paths, narrowed fields).
 *
 * @typeParam T - The entity type.
 * @typeParam S - The projection literal type, or `undefined`.
 * @example
 * type A = ProjectionBase<User, undefined>; // User
 * type B = ProjectionBase<User, { name: 1 }>; // Projected<User, "_id" | "name">
 * type C = ProjectionBase<User, Record<string, 0 | 1>>; // Partial<User>
 */
export type ProjectionBase<T, S> = [S] extends [undefined]
  ? T
  : IsWideProjection<S> extends false
    ? [IncludedKeys<S>] extends [never]
      ? [ExcludedKeys<S>] extends [never]
        ? S extends { readonly _id: Truthy }
          ? Pick<T, Extract<"_id", keyof T>>
          : [IdOut<S>] extends [never]
            ? T
            : Omit<T, IdOut<S>>
        : HasDotted<ExcludedKeys<S>> extends true
          ? ApplyProjection<T, S>
          : Omit<T, (ExcludedKeys<S> & string) | IdOut<S>>
      : HasDotted<IncludedKeys<S> | SlicedKeys<S>> extends true
        ? ApplyProjection<T, S>
        : Projected<
            T,
            Extract<
              ((IncludedKeys<S> | SlicedKeys<S>) & string) | (S extends { readonly _id: Falsy } ? never : "_id"),
              keyof T
            >
          >
    : Partial<T>;

/**
 * The top-level keys of a projected shape `V` that hold `Hidden` paths (a field added with `+path`, an embedded
 * document whose `Hidden` field was included): the default view of {@link ProjectionBase} would drop them, so the
 * document type lists them among the fields that differ. None for the default read.
 *
 * @typeParam S - The projection literal type, or `undefined`.
 * @typeParam V - The projected shape (`ApplyProjection<T, S>`).
 * @example
 * type A = KeptHiddenKeys<{ "+pin": true }, { owner: string; pin?: Hidden<string> }>; // "pin"
 */
export type KeptHiddenKeys<S, V> = [S] extends [undefined]
  ? never
  : HiddenPaths<V> extends infer P
    ? P extends `${infer H}.${string}`
      ? H
      : P
    : never;

/* ---- sort ---- */

/**
 * A sort direction: `1`/`-1` or a word — `"asc"`/`"ascending"` (= 1), `"desc"`/`"descending"` (= -1).
 * The plan always holds `1`/`-1` (`QuerySpecs.sort` normalizes).
 *
 * @example
 * const a: SortDirection = -1;
 * const b: SortDirection = "desc";
 */
export type SortDirection = 1 | -1 | "asc" | "desc" | "ascending" | "descending";

/**
 * The paths a sort may name (through arrays, as the server does).
 *
 * @typeParam T - The entity type.
 * @example
 * type A = SortPath<{ name: string; tags: { label: string }[] }>; // "name" | "tags" | "tags.label" | "_id"
 */
export type SortPath<T> = Paths<T> | "_id";

/**
 * The direction of a text score field (`textScore()`): the server sorts a score from the best match only.
 *
 * @example
 * const best: ScoreDirection = -1;
 */
export type ScoreDirection = -1 | "desc" | "descending";

/**
 * A sort: an object (insertion order) or an explicit list of `[path, direction]` pairs. `Score` names the text
 * score fields of the query (`textScore(name)`): they sort descending only, by `{ $meta: "textScore" }`.
 *
 * @typeParam T - The entity type.
 * @typeParam Score - The text score fields of the query; none by default.
 * @example
 * const a: Sort<User> = { age: -1, name: 1 };
 * const b: Sort<User> = [["age", -1], ["name", "asc"]];
 * const c: Sort<User, "score"> = { score: -1, name: 1 };
 */
export type Sort<T, Score extends string = never> = [Score] extends [never]
  ? { readonly [P in SortPath<T>]?: SortDirection } | readonly (readonly [SortPath<T>, SortDirection])[]
  : /* Without score fields the object form stays a plain weak type: an intersection with an empty mapped type
       would let a string through. */
      | ({ readonly [P in SortPath<T>]?: SortDirection } & { readonly [P in Score]?: ScoreDirection })
      | readonly (readonly [SortPath<T>, SortDirection] | readonly [Score, ScoreDirection])[];
