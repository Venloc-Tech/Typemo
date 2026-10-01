import type { ObjectId, UUID } from "mongodb";
import type { IsPlainObject } from "../bson/opaque-value.ts";
import type { DocumentOf, FieldsWith, ShownFields } from "../document/document-types.ts";
import type { Lean } from "./document-forms.ts";
import type { Filter } from "./filter.ts";
import type {
  IsVirtualRef,
  RefModel,
  Unbranded,
  VirtualRefCount,
  VirtualRefJustOne,
  VirtualRefModel,
} from "./markers.ts";
import type { ApplyNarrow, NoNarrowing } from "./narrow.ts";
import type {
  ApplyProjection,
  DefaultView,
  KeptHiddenKeys,
  Projection,
  ProjectionBase,
  ProjectionModeCheck,
  Sort,
} from "./projection.ts";
import type { Dec, Simplify, StringKeys } from "./type-utils.ts";

/*
 * Populate types:
 * - a path is CHECKED segment by segment (`WalkPopulate`, cost = its length), never enumerated: a union
 *   of all paths had 97k–151k members on a dense model graph (TS2590 on the object form);
 * - the IDE hint enumerates paths of depth ≤ 3 only; deeper paths (up to the ceiling 7) are checked with
 *   a readable message but not offered;
 * - `ApplyPopulate` is ONE pass over the keys (a per-path fold hit TS2589 on two paths);
 * - "lean first": the target is converted to its lean shape BEFORE populate (a lean conversion after
 *   populate compared every property type and hit TS2589 at depth 7 in a fresh file);
 * - the object and array forms are checked per given element (`select`, `match`, `options`, nested
 *   `populate`); errors are collected and reported through one extra property, instead of loosely typed
 *   `any` specs;
 * - a populated single reference may be `null` (the referenced document is gone, or `match` left it out);
 *   `required: true` removes the `null`; a `justOne` virtual may be `null`.
 *
 * The types follow the runtime exactly (shape tests cover every variant):
 * - HYDRATED results: a populated field holds hydrated documents of the target model (`HydratedDoc<…>`),
 *   read-only arrays and Maps of them (the runtime's `PopulatedArray`/`PopulatedMap`); in the document's shape
 *   the field is a `PopulatedField<Value, Original>` box, which the hydrated view unboxes to `Value` and
 *   `$depopulate` turns back into `Original` (the stored ids: exact types for `$depopulate`, `$set`, `$populate`);
 * - `transform` (Mongoose H6): typed by the populated document and the id, the field holds what it returns;
 * - embedded discriminator unions: paths and results per member (a field of one member only is populatable);
 * - `match` may be a function of the document (one query per document).
 */

/**
 * Populate depth ceiling of the path check.
 *
 * @example
 * type D = MaxPopulateDepth; // 7
 */
export type MaxPopulateDepth = 7;

/**
 * Depth of the paths the IDE offers.
 *
 * @example
 * type D = PopulateHintDepth; // 3
 */
export type PopulateHintDepth = 3;

declare const POPULATED: unique symbol;

/**
 * A populated field in the shape of a HYDRATED document (type only, never a runtime value): `Value` is what
 * the field holds after populate (hydrated documents, read-only arrays and Maps of them, a count, transform
 * results), `Original` is the stored field (`Ref<M>`, `Ref<M>[]`, `Map<string, Ref<M>>`, a `VirtualRef`).
 * The hydrated view (`HydratedDoc`) shows `Value`; `$depopulate()` gives back `Original`; `$set` takes `Original`.
 *
 * @typeParam Value - What the field holds after populate.
 * @typeParam Original - The stored field.
 * @typeParam Transformed - Whether the values are `transform` results instead of documents.
 * @example
 * type F = PopulatedField<HydratedDoc<User>, Ref<User>>;
 */
export interface PopulatedField<Value, Original, Transformed extends boolean = false> {
  /** The phantom key holding `[Value, Original, Transformed]`; never present at run time. */
  readonly [POPULATED]: readonly [Value, Original, Transformed];
}

/**
 * Any populated field (a presence test on the phantom key: no inference into the value).
 *
 * @example
 * type A = PopulatedField<string, string> extends AnyPopulatedField ? true : false; // true
 */
export interface AnyPopulatedField {
  /** The phantom key of every populated field. */
  readonly [POPULATED]: readonly [unknown, unknown, boolean];
}

/**
 * The value a populated field shows (unboxed); anything else as it is.
 *
 * @typeParam V - The field type.
 * @example
 * type A = PopulatedValueOf<PopulatedField<HydratedDoc<User>, Ref<User>>>; // HydratedDoc<User>
 * type B = PopulatedValueOf<string>; // string
 */
export type PopulatedValueOf<V> = V extends AnyPopulatedField ? V[typeof POPULATED][0] : V;

/**
 * The stored field behind a populated field (the ids); anything else as it is.
 *
 * @typeParam V - The field type.
 * @example
 * type A = PopulatedOriginalOf<PopulatedField<HydratedDoc<User>, Ref<User>>>; // Ref<User>
 */
export type PopulatedOriginalOf<V> = V extends AnyPopulatedField ? V[typeof POPULATED][1] : V;

/**
 * `true` for a populated field whose values are transform results (no document to convert).
 *
 * @typeParam V - The field type.
 * @example
 * type A = IsTransformed<PopulatedField<string, Ref<User>, true>>; // true
 * type B = IsTransformed<string>; // false
 */
export type IsTransformed<V> = V extends AnyPopulatedField ? V[typeof POPULATED][2] : false;

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
 * type A = Join<"a", "b">; // "a.b"
 */
type Join<K extends string, Sub> = Sub extends string ? `${K}.${Sub}` : never;
/**
 * The string keys of `T` that are not methods.
 *
 * @typeParam T - The entity type.
 * @example
 * class User { name!: string; save(): void {} }
 * type A = NonFunctionKeys<User>; // "name"
 */
type NonFunctionKeys<T> = {
  [K in StringKeys<T>]-?: NonNullable<T[K]> extends (...args: never) => unknown ? never : K;
}[StringKeys<T>];

/**
 * The document type one populate segment leads to: the referenced model, the virtual's model or the embedded element.
 *
 * @typeParam V - The field type of the segment.
 * @example
 * type A = SegmentTarget<Ref<User>>; // User
 * type B = SegmentTarget<VirtualRef<Post>>; // Post
 * type C = SegmentTarget<{ zip: string }[]>; // { zip: string }
 * type D = SegmentTarget<string>; // never
 */
export type SegmentTarget<V> = [RefModel<V>] extends [never]
  ? [VirtualRefModel<V>] extends [never]
    ? true extends IsPlainObject<Elem<V>>
      ? Extract<Elem<V>, object>
      : never
    : VirtualRefModel<V>
  : RefModel<V>;

/**
 * `true` when the field holds a reference or a populate virtual.
 *
 * @typeParam V - The field type.
 * @example
 * type A = IsPopulatable<Ref<User>>; // true
 * type B = IsPopulatable<string>; // false
 */
type IsPopulatable<V> = [RefModel<V>] extends [never] ? ([VirtualRefModel<V>] extends [never] ? false : true) : true;
/**
 * `true` when the model type is a union (a polymorphic reference).
 *
 * @typeParam M - The model type.
 * @typeParam U - The whole union; callers leave it at its default.
 * @example
 * type A = IsModelUnion<User | Admin>; // true
 * type B = IsModelUnion<User>; // false
 */
type IsModelUnion<M, U = M> = M extends unknown ? ([U] extends [M] ? false : true) : never;
/**
 * The value type of a Map, `never` for a non-Map.
 *
 * @typeParam V - The field type.
 * @example
 * type A = MapValue<Map<string, Ref<User>>>; // Ref<User>
 */
type MapValue<V> = V extends ReadonlyMap<string, infer E> ? NonNullable<E> : never;
/**
 * `true` for a field that is populated already (a `PopulatedField` box).
 *
 * @typeParam V - The field type.
 * @example
 * type A = IsBoxed<PopulatedField<string, string>>; // true
 */
type IsBoxed<V> = V extends AnyPopulatedField ? true : false;

/**
 * Populate paths of `T` up to depth `D`, ENUMERATED: used only for the IDE hint (depth 3). Per member of a union.
 *
 * @typeParam T - The entity type.
 * @typeParam D - The remaining depth.
 * @example
 * type A = PopulatePaths<{ author: Ref<User>; tags: string[] }>; // "author" | `author.${...}`
 */
export type PopulatePaths<T, D extends number = PopulateHintDepth> = T extends unknown
  ? D extends 0
    ? never
    : { [K in NonFunctionKeys<T>]: PopulateSub<K, NonNullable<T[K]>, D> }[NonFunctionKeys<T>]
  : never;

/**
 * The populate paths of one key: the key itself when it is populatable, plus the paths below its target.
 * A Map of references is `key.$*`.
 *
 * @typeParam K - The key.
 * @typeParam V - The field type.
 * @typeParam D - The remaining depth.
 * @example
 * type A = PopulateSub<"author", Ref<User>, 3>; // "author" | `author.${paths of User}`
 * type B = PopulateSub<"friends", Map<string, Ref<User>>, 3>; // "friends.$*"
 */
type PopulateSub<K extends string, V, D extends number> =
  V extends ReadonlyMap<string, infer E>
    ? [RefModel<E>] extends [never]
      ? true extends IsPlainObject<NonNullable<E>>
        ? Join<`${K}.$*`, PopulatePaths<Extract<NonNullable<E>, object>, Dec[D]>>
        : never
      : `${K}.$*`
    : IsBoxed<V> extends true
      ? never
      : [SegmentTarget<V>] extends [never]
        ? never
        : IsPopulatable<V> extends true
          ? IsModelUnion<SegmentTarget<V>> extends true
            ? K
            : K | Join<K, PopulatePaths<SegmentTarget<V>, Dec[D]>>
          : Join<K, PopulatePaths<SegmentTarget<V>, Dec[D]>>;

/**
 * What the IDE completes: paths of depth ≤ 3, every key, and any dotted continuation (checked).
 *
 * @typeParam T - The entity type.
 * @example
 * const path: PopulatePathHint<Post> = "author";
 */
export type PopulatePathHint<T> =
  | PopulatePaths<T>
  | NonFunctionKeys<T>
  | `${NonFunctionKeys<T>}.${string}`
  /*
   * Any other string too, so a wrong path reaches `CheckedPopulatePath` and gets its message (a failed
   * constraint would print every hint instead). `string & Record<never, never>` keeps the completions.
   */
  | (string & Record<never, never>);

/**
 * `true`, or why path `P` of `T` cannot be populated (a message literal). For a union `T` (embedded
 * discriminators) the result is per member: the path is valid when one member has it.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate path.
 * @typeParam D - The remaining depth.
 * @example
 * type A = WalkPopulate<Post, "author">; // true
 * type B = WalkPopulate<Post, "title">; // `"title" is not a reference`
 */
export type WalkPopulate<T, P extends string, D extends number = MaxPopulateDepth> = T extends unknown
  ? WalkOne<T, P, D>
  : never;

/**
 * Walks path `P` of one union member `T` segment by segment: `$*` steps into a Map, a reference or a
 * virtual steps into its target model, an embedded document into itself. A path whose last field is populated
 * already is valid (a second populate replaces the first: the stored field is walked); a path that goes on
 * below a populated field is not (the populated documents are not re-typed in place).
 *
 * @typeParam T - The entity type (one member).
 * @typeParam P - The populate path.
 * @typeParam D - The remaining depth.
 * @example
 * type A = WalkOne<Post, "author.company", 7>; // true when `User.company` is a reference
 */
type WalkOne<T, P extends string, D extends number> = D extends 0
  ? `populate path is deeper than the ${MaxPopulateDepth}-level ceiling`
  : P extends `${infer H}.$*.${infer R}`
    ? H extends StringKeys<T>
      ? NonNullable<T[H]> extends ReadonlyMap<string, infer E>
        ? true extends IsPlainObject<NonNullable<E>>
          ? WalkPopulate<Extract<NonNullable<E>, object>, R, Dec[D]>
          : `the values of map "${H}" are not embedded documents`
        : `"${H}" is not a Map ($* needs one)`
      : `unknown field "${H}"`
    : P extends `${infer H}.$*`
      ? H extends StringKeys<T>
        ? NonNullable<PopulatedOriginalOf<T[H]>> extends ReadonlyMap<string, infer E>
          ? [RefModel<E>] extends [never]
            ? `the values of map "${H}" are not references`
            : true
          : `"${H}" is not a Map ($* needs one)`
        : `unknown field "${H}"`
      : P extends `${infer H}.${infer R}`
        ? H extends StringKeys<T>
          ? IsBoxed<NonNullable<T[H]>> extends true
            ? `"${H}" is populated already: $depopulate("${H}") first`
            : [SegmentTarget<NonNullable<T[H]>>] extends [never]
              ? `"${H}" is neither a reference nor an embedded document`
              : IsPopulatable<NonNullable<T[H]>> extends true
                ? IsModelUnion<SegmentTarget<NonNullable<T[H]>>> extends true
                  ? `"${H}" is a polymorphic reference: nothing below it can be populated`
                  : WalkPopulate<SegmentTarget<NonNullable<T[H]>>, R, Dec[D]>
                : WalkPopulate<SegmentTarget<NonNullable<T[H]>>, R, Dec[D]>
          : `unknown field "${H}"`
        : P extends StringKeys<T>
          ? IsPopulatable<NonNullable<PopulatedOriginalOf<T[P]>>> extends true
            ? true
            : `"${P}" is not a reference`
          : `unknown field "${P}"`;

/**
 * `P` itself when it is a valid populate path of `T`, otherwise an error message literal.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate path.
 * @example
 * type A = CheckedPopulatePath<Post, "author">; // "author"
 * type B = CheckedPopulatePath<Post, "title">; // `Invalid populate path "title": "title" is not a reference`
 */
export type CheckedPopulatePath<T, P extends string> = string extends P
  ? `populate path must be a literal`
  : WalkPopulate<T, P> extends infer W
    ? true extends W
      ? P
      : `Invalid populate path "${P}": ${W & string}`
    : never;

/**
 * The document type at the END of populate path `P` of `T` (`never` when invalid). Per member of a union.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate path.
 * @example
 * type A = PopulateTargetOf<Post, "author">; // User
 * type B = PopulateTargetOf<Post, "author.company">; // Company
 */
export type PopulateTargetOf<T, P extends string> = T extends unknown
  ? P extends `${infer H}.$*.${infer R}`
    ? H extends keyof T
      ? PopulateTargetOf<MapValue<NonNullable<T[H]>>, R>
      : never
    : P extends `${infer H}.$*`
      ? H extends keyof T
        ? SegmentTarget<MapValue<NonNullable<PopulatedOriginalOf<T[H]>>>>
        : never
      : P extends `${infer H}.${infer R}`
        ? H extends keyof T
          ? PopulateTargetOf<SegmentTarget<NonNullable<T[H]>>, R>
          : never
        : P extends keyof T
          ? SegmentTarget<NonNullable<PopulatedOriginalOf<T[P]>>>
          : never
  : never;

/**
 * The stored field at the end of populate path `P` of `T` (the reference, the Map of references, the virtual).
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate path.
 * @example
 * type A = PopulateFieldOf<Post, "author">; // Ref<User>
 */
type PopulateFieldOf<T, P extends string> = T extends unknown
  ? P extends `${infer H}.$*.${infer R}`
    ? H extends keyof T
      ? PopulateFieldOf<MapValue<NonNullable<T[H]>>, R>
      : never
    : P extends `${infer H}.$*`
      ? H extends keyof T
        ? MapValue<NonNullable<PopulatedOriginalOf<T[H]>>>
        : never
      : P extends `${infer H}.${infer R}`
        ? H extends keyof T
          ? PopulateFieldOf<SegmentTarget<NonNullable<T[H]>>, R>
          : never
        : P extends keyof T
          ? NonNullable<PopulatedOriginalOf<T[P]>>
          : never
  : never;

/* ---- entries (what the query accumulated) ---- */

/**
 * How a populated value is shaped (options of the object form).
 *
 * @example
 * type S = PopulateShape; // { justOne, retain, matched, required, transform }
 */
export interface PopulateShape {
  /** The `justOne` option, `undefined` when not given. */
  readonly justOne: boolean | undefined;
  /** The `retainNullValues` option, `undefined` when not given. */
  readonly retain: boolean | undefined;
  /** Whether a `match` was given. */
  readonly matched: boolean;
  /** `required: true` — a reference that finds nothing is an error, so the value is never `null`. */
  readonly required: boolean | undefined;
  /** `[R]` when a `transform` returning `R` is given (the populated values become what it returns). */
  readonly transform: readonly [unknown] | undefined;
}

/**
 * The shape of a plain string path.
 *
 * @example
 * type S = DefaultShape; // every option `undefined`, `matched: false`
 */
export interface DefaultShape extends PopulateShape {
  /** Not given. */
  readonly justOne: undefined;
  /** Not given. */
  readonly retain: undefined;
  /** No `match`. */
  readonly matched: false;
  /** Not given. */
  readonly required: undefined;
  /** No `transform`. */
  readonly transform: undefined;
}

/**
 * One populated path: its projection and shape.
 *
 * @example
 * type E = { readonly path: "author"; readonly select: undefined; readonly shape: DefaultShape };
 */
export interface PopulationEntry {
  /** The populate path. */
  readonly path: string;
  /** The projection given for the path, `undefined` when none. */
  readonly select: unknown;
  /** The options that shape the populated value. */
  readonly shape: PopulateShape;
}

/**
 * The `PopulateShape` a populate spec object describes.
 *
 * @typeParam Spec - The populate spec (object form).
 * @example
 * type A = ShapeOf<{ path: "author"; justOne: true }>; // { justOne: true; retain: undefined; ... }
 */
type ShapeOf<Spec> = {
  readonly justOne: Spec extends { readonly justOne: infer J extends boolean } ? J : undefined;
  readonly retain: Spec extends { readonly retainNullValues: infer R extends boolean } ? R : undefined;
  readonly matched: Spec extends { readonly match: unknown } ? true : false;
  readonly required: Spec extends { readonly required: infer Q extends boolean } ? Q : undefined;
  readonly transform: Spec extends { readonly transform: (...args: never) => infer R } ? readonly [R] : undefined;
};

/**
 * An entry of a nested `populate`, with the parent path prepended.
 *
 * @typeParam Prefix - The parent path.
 * @typeParam E - The nested entry.
 * @example
 * type A = PrefixEntry<"author", { path: "company"; select: undefined; shape: DefaultShape }>;
 * // { path: "author.company"; ... }
 */
type PrefixEntry<Prefix extends string, E> = E extends PopulationEntry
  ? { readonly path: `${Prefix}.${E["path"]}`; readonly select: E["select"]; readonly shape: E["shape"] }
  : never;

/**
 * The entries a populate argument adds (string, object, list; nested `populate` prefixed). A non-literal
 * path adds nothing and is not walked into (comparing two generic signatures instantiates the loose
 * `PopulateObject`, whose `populate` refers to itself: TS2589 without this stop).
 *
 * @typeParam Spec - The populate argument.
 * @example
 * type A = ExtractPopulationEntries<"author">; // { path: "author"; select: undefined; shape: DefaultShape }
 * type B = ExtractPopulationEntries<{ path: "author"; select: { name: 1 } }>; // the entry with the select
 */
export type ExtractPopulationEntries<Spec> = Spec extends string
  ? string extends Spec
    ? never
    : { readonly path: Spec; readonly select: undefined; readonly shape: DefaultShape }
  : Spec extends { readonly path: infer P extends string }
    ? string extends P
      ? never
      :
          | {
              readonly path: P;
              readonly select: Spec extends { readonly select: infer S } ? S : undefined;
              readonly shape: ShapeOf<Spec>;
            }
          | (Spec extends { readonly populate: infer N } ? PrefixEntry<P, ExtractPopulationEntries<N>> : never)
    : Spec extends readonly (infer U)[]
      ? ExtractPopulationEntries<U>
      : never;

/**
 * Entries `Old` with the paths of `New` replaced (populating a path again replaces it, as at run time).
 *
 * @typeParam Old - The entries so far.
 * @typeParam New - The entries just added.
 * @example
 * type A = ReplaceEntries<EntryA1, EntryA2>; // EntryA2 (same path replaced)
 */
export type ReplaceEntries<Old extends PopulationEntry, New extends PopulationEntry> =
  | (Old extends unknown ? (Old["path"] extends New["path"] ? never : Old) : never)
  | New;

/**
 * The entry whose path is exactly `K`.
 *
 * @typeParam Entries - The entries.
 * @typeParam K - The path.
 * @example
 * type A = ExactEntry<EntryAuthor | EntryTags, "author">; // EntryAuthor
 */
type ExactEntry<Entries extends PopulationEntry, K extends string> = Extract<Entries, { readonly path: K }>;
/**
 * The projection given for path `K`, `undefined` when the path is not populated.
 *
 * @typeParam Entries - The entries.
 * @typeParam K - The path.
 * @example
 * type A = SelectFor<EntryAuthorSelectName, "author">; // { name: 1 }
 */
type SelectFor<Entries extends PopulationEntry, K extends string> = [ExactEntry<Entries, K>] extends [never]
  ? undefined
  : ExactEntry<Entries, K>["select"];
/**
 * The shape of path `K`, the default shape when the path is not populated.
 *
 * @typeParam Entries - The entries.
 * @typeParam K - The path.
 * @example
 * type A = ShapeFor<never, "author">; // DefaultShape
 */
type ShapeFor<Entries extends PopulationEntry, K extends string> = [ExactEntry<Entries, K>] extends [never]
  ? DefaultShape
  : ExactEntry<Entries, K>["shape"];
/**
 * The entries below key `K`, with `K.` removed from their paths.
 *
 * @typeParam Entries - The entries.
 * @typeParam K - The key.
 * @example
 * type A = RestFor<{ path: "author.company"; ... }, "author">; // { path: "company"; ... }
 */
type RestFor<Entries extends PopulationEntry, K extends string> = Entries extends { readonly path: `${K}.${infer R}` }
  ? { readonly path: R; readonly select: Entries["select"]; readonly shape: Entries["shape"] }
  : never;
/**
 * The entries below the values of Map key `K` (`K.$*.`), with the prefix removed from their paths.
 *
 * @typeParam Entries - The entries.
 * @typeParam K - The Map key.
 * @example
 * type A = MapRestFor<{ path: "friends.$*.company"; ... }, "friends">; // { path: "company"; ... }
 */
type MapRestFor<Entries extends PopulationEntry, K extends string> = Entries extends {
  readonly path: `${K}.$*.${infer R}`;
}
  ? { readonly path: R; readonly select: Entries["select"]; readonly shape: Entries["shape"] }
  : never;

/**
 * Keys of `T` touched by `Entries` (the path itself or a path below it).
 *
 * @typeParam T - The entity type.
 * @typeParam Entries - The entries.
 * @example
 * type A = PopulatedKeys<Post, EntryAuthor>; // "author"
 */
export type PopulatedKeys<T, Entries extends PopulationEntry> = {
  [K in keyof T]-?: K extends string
    ? [Extract<Entries, { readonly path: K } | { readonly path: `${K}.${string}` }>] extends [never]
      ? never
      : K
    : never;
}[keyof T];

/**
 * The lean shape of `T` before populate ("lean first"): `Lean<T>` without the populated keys, which
 * are kept as declared (a `VirtualRef` is not data and `Lean` would drop it; a `Map` must stay a `Map`
 * to be walked); `ApplyPopulate` replaces them, converting their targets to lean one level down.
 *
 * @typeParam T - The entity type.
 * @typeParam Entries - The entries.
 * @example
 * type A = LeanBase<Post, EntryAuthor>; // the lean Post whose `author` is still `Ref<User>`
 */
export type LeanBase<T, Entries extends PopulationEntry> = Simplify<
  Omit<Lean<T>, PopulatedKeys<T, Entries>> & Pick<T, PopulatedKeys<T, Entries>>
>;

/**
 * Prepares a populate target for the entries below it: lean results convert it to its lean base first.
 *
 * @typeParam Target - The target document type.
 * @typeParam Rest - The entries below the target.
 * @typeParam IsLean - Whether the result is lean.
 * @example
 * type A = Prepare<User, never, true>; // LeanBase<User, never>
 * type B = Prepare<User, never, false>; // User
 */
type Prepare<Target, Rest extends PopulationEntry, IsLean extends boolean> = IsLean extends true
  ? Target extends unknown
    ? LeanBase<Target, Rest>
    : never
  : Target;

/**
 * A populated target: the projection applied, then its own populate entries.
 *
 * @typeParam Target - The target document type.
 * @typeParam S - The projection given for the path, or `undefined`.
 * @typeParam Rest - The entries below the target.
 * @typeParam IsLean - Whether the result is lean.
 * @example
 * type A = Populated<User, { name: 1 }, never, true>; // { _id: ObjectId; name: string }
 */
type Populated<Target, S, Rest extends PopulationEntry, IsLean extends boolean> = ApplyPopulate<
  Prepare<[S] extends [undefined] ? ApplyProjection<Target, undefined> : ApplyProjection<Target, S>, Rest, IsLean>,
  Rest,
  IsLean
>;

/**
 * The hydrated document a read of `T` gives: projection `S`, populate entries `E`, narrowing `N`/`X`. Its type
 * names the class part (`ProjectionBase`) and only the fields that differ from its default read — populated paths,
 * `Hidden` fields kept by the projection, narrowed fields: `HydratedDoc<User>`, or
 * `HydratedDocWith<Post, { author: HydratedDoc<Person> | null }>`.
 *
 * @typeParam T - The entity type.
 * @typeParam S - The projection, or `undefined`.
 * @typeParam E - The populate entries.
 * @typeParam N - The narrowing state.
 * @typeParam X - The fields known to exist.
 * @example
 * type A = HydratedResult<User, undefined, never, NoNarrowing, never>; // HydratedDoc<User>
 */
export type HydratedResult<T, S, E extends PopulationEntry, N, X extends string> = DocumentOf<
  ProjectionBase<T, S>,
  ShownFields<
    ApplyNarrow<ApplyPopulate<ApplyProjection<T, S>, E, false>, N, X>,
    PopulatedKeys<ApplyProjection<T, S>, E> | KeptHiddenKeys<S, ApplyProjection<T, S>> | keyof N | X
  >
>;

/**
 * One populated document of a reference: the lean shape (`Target` prepared and populated), or a hydrated document
 * of the target model ({@link HydratedResult}, per member of a polymorphic target).
 *
 * @typeParam Target - The target document type.
 * @typeParam S - The projection given for the path, or `undefined`.
 * @typeParam Rest - The entries below the target.
 * @typeParam IsLean - Whether the result is lean.
 * @example
 * type A = PopulatedTarget<User, undefined, never, false>; // HydratedDoc<User>
 */
type PopulatedTarget<Target, S, Rest extends PopulationEntry, IsLean extends boolean> = IsLean extends true
  ? Populated<Target, S, Rest, true>
  : Target extends unknown
    ? HydratedResult<Target, S, Rest, NoNarrowing, never>
    : never;

/**
 * An embedded document (or Map value) with populated paths inside: its lean shape, or for a hydrated result the
 * shape named by its class and the populated fields (`FieldsWith<Line, { product: HydratedDoc<Product> | null }>`).
 *
 * @typeParam Target - The embedded class.
 * @typeParam Rest - The entries below it.
 * @typeParam IsLean - Whether the result is lean.
 * @example
 * type A = EmbeddedPopulated<Line, EntryProduct, false>; // FieldsWith<Line, { product: … }>
 */
type EmbeddedPopulated<Target, Rest extends PopulationEntry, IsLean extends boolean> = IsLean extends true
  ? Populated<Target, undefined, Rest, true>
  : Target extends unknown
    ? [PopulatedKeys<DefaultView<Target>, Rest>] extends [never]
      ? DefaultView<Target>
      : FieldsWith<
          Target,
          ShownFields<ApplyPopulate<DefaultView<Target>, Rest, false>, PopulatedKeys<DefaultView<Target>, Rest>>
        >
    : never;

/**
 * A list of populated values: a plain array (lean), a read-only array (hydrated: `PopulatedArray`).
 *
 * @typeParam V - The element type.
 * @typeParam IsLean - Whether the result is lean.
 * @example
 * type A = ListOf<User, true>; // User[]
 * type B = ListOf<User, false>; // readonly User[]
 */
type ListOf<V, IsLean extends boolean> = IsLean extends true ? V[] : readonly V[];
/**
 * A Map of populated values: a plain record (lean), a read-only Map (hydrated).
 *
 * @typeParam IsLean - Whether the result is lean.
 * @typeParam V - The value type.
 * @example
 * type A = MapOf<true, User>; // { [key: string]: User }
 * type B = MapOf<false, User>; // ReadonlyMap<string, User>
 */
type MapOf<IsLean extends boolean, V> = IsLean extends true ? { [key: string]: V } : ReadonlyMap<string, V>;

/**
 * One element of a populated value: the document (lean shape or hydrated document, prepared by the caller), or
 * what `transform` returns for it (Mongoose H6).
 *
 * @typeParam E - The populated document.
 * @typeParam Shape - The populate shape.
 * @example
 * type A = ElemOf<User, DefaultShape>; // User
 */
type ElemOf<E, Shape extends PopulateShape> = Shape["transform"] extends readonly [infer R] ? R : E;
/**
 * A list of populated elements; `retainNullValues` keeps a `null` for each reference that found nothing.
 *
 * @typeParam E - The populated entity shape.
 * @typeParam Shape - The populate shape.
 * @typeParam IsLean - Whether the result is lean.
 * @example
 * type A = ManyOf<User, DefaultShape, true>; // User[]
 */
type ManyOf<E, Shape extends PopulateShape, IsLean extends boolean> = Shape["transform"] extends readonly [unknown]
  ? ListOf<ElemOf<E, Shape>, IsLean>
  : Shape["retain"] extends true
    ? ListOf<ElemOf<E, Shape> | null, IsLean>
    : ListOf<ElemOf<E, Shape>, IsLean>;
/**
 * One document or `null` (not found / not matched); a transform decides for `null` itself; `required: true`
 * makes "not found" an error, so there is no `null`.
 *
 * @typeParam E - The populated entity shape.
 * @typeParam Shape - The populate shape.
 * @example
 * type A = OneOrNull<User, DefaultShape>; // User | null
 */
type OneOrNull<E, Shape extends PopulateShape> = Shape["transform"] extends readonly [unknown]
  ? ElemOf<E, Shape>
  : Shape["required"] extends true
    ? ElemOf<E, Shape>
    : ElemOf<E, Shape> | null;

/**
 * The value a populated field holds (without the stored field's own `null`/`undefined`), BOXED in a
 * one-element tuple and read back with `[0]`: a union that is the top-level result of an alias is printed by
 * the alias name in the IDE hover; a union built inside the box has no alias.
 *
 * @typeParam Original - The stored field type.
 * @typeParam E - The populated entity shape.
 * @typeParam Shape - The populate shape.
 * @typeParam IsLean - Whether the result is lean.
 * @example
 * type A = PopulatedBox<Ref<User>, User, DefaultShape, true>[0]; // User
 * type B = PopulatedBox<Ref<User>[], User, DefaultShape, true>[0]; // User[]
 */
type PopulatedBox<Original, E, Shape extends PopulateShape, IsLean extends boolean> = [
  NonNullable<Original> extends readonly unknown[]
    ? [RefModel<Original>] extends [never]
      ? E[]
      : Shape["justOne"] extends true
        ? OneOrNull<E, Shape>
        : ManyOf<E, Shape, IsLean>
    : [RefModel<Original>] extends [never]
      ? [VirtualRefModel<Original>] extends [never]
        ? E
        : VirtualRefCount<Original> extends true
          ? number
          : (Shape["justOne"] extends boolean ? Shape["justOne"] : VirtualRefJustOne<Original>) extends true
            ? OneOrNull<E, Shape>
            : ManyOf<E, Shape, IsLean>
      : Shape["justOne"] extends false
        ? ManyOf<E, Shape, IsLean>
        : OneOrNull<E, Shape>,
];

/**
 * In a hydrated shape the populated value is boxed with the stored field (see `PopulatedField`).
 *
 * @typeParam V - The populated value.
 * @typeParam Original - The stored field type.
 * @typeParam Shape - The populate shape.
 * @typeParam IsLean - Whether the result is lean.
 * @example
 * type A = Boxed<User, Ref<User>, DefaultShape, true>; // User
 * type B = Boxed<HydratedDoc<User>, Ref<User>, DefaultShape, false>; // PopulatedField<...>
 */
type Boxed<V, Original, Shape extends PopulateShape, IsLean extends boolean> = IsLean extends true
  ? V
  : PopulatedField<V, Original, Shape["transform"] extends readonly [unknown] ? true : false>;

/**
 * The type of one key of a populated document: a Map of references, a reference or virtual, or an
 * embedded document with populated paths inside. A key populated already is populated anew from its stored
 * field (a second populate replaces the first).
 *
 * @typeParam T - The entity type.
 * @typeParam K - The key.
 * @typeParam Entries - The entries.
 * @typeParam IsLean - Whether the result is lean.
 * @typeParam F - The stored field (the field itself, or the stored field of a populated box).
 * @example
 * type A = ApplyField<Post, "author", EntryAuthor, true>; // User
 */
type ApplyField<
  T,
  K extends keyof T & string,
  Entries extends PopulationEntry,
  IsLean extends boolean,
  F = PopulatedOriginalOf<T[K]>,
> =
  NonNullable<F> extends ReadonlyMap<string, infer E>
    ?
        | Extract<F, null | undefined>
        | ([ExactEntry<Entries, `${K}.$*`>] extends [never]
            ? IsLean extends true
              ? { [key: string]: Populated<Extract<NonNullable<E>, object>, undefined, MapRestFor<Entries, K>, IsLean> }
              : Map<string, EmbeddedPopulated<Extract<NonNullable<E>, object>, MapRestFor<Entries, K>, IsLean>>
            : Boxed<
                MapOf<
                  IsLean,
                  PopulatedBox<
                    E,
                    PopulatedTarget<SegmentTarget<NonNullable<E>>, SelectFor<Entries, `${K}.$*`>, never, IsLean>,
                    ShapeFor<Entries, `${K}.$*`>,
                    IsLean
                  >[0]
                >,
                /* `Exclude`, not `NonNullable` (`T & {}`): keeps the alias of the stored type for the hover. */
                Exclude<F, null | undefined>,
                ShapeFor<Entries, `${K}.$*`>,
                IsLean
              >)
    : [SegmentTarget<NonNullable<F>>] extends [never]
      ? F
      : IsPopulatable<NonNullable<F>> extends true
        ?
            | ([VirtualRefModel<F>] extends [never] ? Extract<F, null | undefined> : never)
            | Boxed<
                PopulatedBox<
                  F,
                  PopulatedTarget<SegmentTarget<NonNullable<F>>, SelectFor<Entries, K>, RestFor<Entries, K>, IsLean>,
                  ShapeFor<Entries, K>,
                  IsLean
                >[0],
                [VirtualRefModel<F>] extends [never] ? Exclude<F, null | undefined> : F,
                ShapeFor<Entries, K>,
                IsLean
              >
        : /*
           * An embedded document (or an array of them) with populated paths inside: its shape changes, it is
           * not a populated value itself.
           */
            | Extract<F, null | undefined>
            | PopulatedBox<
                NonNullable<F>,
                EmbeddedPopulated<SegmentTarget<NonNullable<F>>, RestFor<Entries, K>, IsLean>,
                DefaultShape,
                true
              >[0];

/**
 * Applies ALL populate entries in ONE pass over the keys of `T` (cost linear in the number of paths).
 * A populated reference keeps its optionality; a populated virtual is always present afterwards.
 * Distributive: a union `T` (embedded discriminators) is populated member by member.
 *
 * @typeParam T - The entity type.
 * @typeParam Entries - The entries.
 * @typeParam IsLean - Whether the result is lean.
 * @example
 * type A = ApplyPopulate<Post, EntryAuthor, true>; // Post with `author: User`
 */
export type ApplyPopulate<T, Entries extends PopulationEntry, IsLean extends boolean> = [Entries] extends [never]
  ? T
  : T extends unknown
    ? Simplify<
        Omit<T, PopulatedKeys<T, Entries>> & {
          -readonly [K in keyof T as K extends PopulatedKeys<T, Entries>
            ? IsVirtualRef<T[K]> extends true
              ? never
              : K
            : never]: K extends string ? ApplyField<T, K, Entries, IsLean> : never;
        } & {
          -readonly [K in PopulatedKeys<T, Entries> as IsVirtualRef<T[K]> extends true ? K : never]-?: K extends string
            ? ApplyField<T, K, Entries, IsLean>
            : never;
        }
      >
    : never;

/* ---- depopulate ---- */

/**
 * Replaces every populated field inside `V` with its stored field, down to depth `D`.
 *
 * @typeParam V - The value type.
 * @typeParam D - The remaining depth.
 * @example
 * type A = Unboxed<PopulatedField<HydratedDoc<User>, Ref<User>>, 4>; // Ref<User>
 */
type Unboxed<V, D extends number> = V extends AnyPopulatedField
  ? PopulatedOriginalOf<V>
  : D extends 0
    ? V
    : V extends readonly (infer E)[]
      ? Unboxed<E, Dec[D]>[]
      : V extends ReadonlyMap<string, infer M>
        ? Map<string, Unboxed<M, Dec[D]>>
        : true extends IsPlainObject<V>
          ? { [K in keyof V]: Unboxed<V[K], Dec[D]> }
          : V;

/**
 * The shape of a hydrated document after `$depopulate(key)`: the populated fields under `K` are their stored ids again.
 *
 * @typeParam T - The hydrated document shape.
 * @typeParam K - The depopulated key.
 * @example
 * type A = Depopulated<{ author: PopulatedField<HydratedDoc<User>, Ref<User>> }, "author">; // { author: Ref<User> }
 * type B = Depopulated<User, "name">; // User (nothing was populated: the class itself, by name)
 */
export type Depopulated<T, K extends PropertyKey> =
  DepopulatedFields<T, K> extends infer M ? ([M] extends [T] ? ([T] extends [M] ? T : M) : M) : never;

/**
 * The fields of {@link Depopulated}: a mapped type over `keyof T` ended by `& {}`, so the IDE prints the fields
 * rather than an alias name.
 *
 * @typeParam T - The hydrated document shape.
 * @typeParam K - The depopulated key.
 * @example
 * type A = DepopulatedFields<{ author: PopulatedField<HydratedDoc<User>, Ref<User>> }, "author">; // { author: Ref<User> }
 */
type DepopulatedFields<T, K extends PropertyKey> = {
  [P in keyof T]: P extends K ? Unboxed<T[P], 4> : T[P];
} & {};

/* ---- the object and array forms: errors collected into one property ---- */

/**
 * Options of the populate query (per populated document: `limit`/`skip` apply per owner, exactly).
 *
 * @typeParam Target - The populated model.
 * @example
 * const options: PopulateQueryOptions<User> = { sort: { name: 1 }, limit: 5 };
 */
export interface PopulateQueryOptions<Target> {
  /** The sort of the populated documents. */
  readonly sort?: Sort<Target>;
  /** At most this many documents per owner (the same as `perDocumentLimit`; one of them). */
  readonly limit?: number;
  /** Skipped documents per owner. */
  readonly skip?: number;
}

/**
 * The keys a populate object may have.
 *
 * @example
 * const key: ObjectKey = "select";
 */
type ObjectKey =
  | "path"
  | "select"
  | "match"
  | "options"
  | "populate"
  | "justOne"
  | "retainNullValues"
  | "perDocumentLimit"
  | "required"
  | "clone"
  | "transform";

/**
 * The message for an invalid populate path of an object or list element, `never` when valid.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The path.
 * @typeParam Prefix - The path of the enclosing populate, with its trailing dot.
 * @example
 * type A = PathErrors<Post, "title", "">; // `invalid populate path "title": "title" is not a reference`
 */
type PathErrors<T, P extends string, Prefix extends string> = string extends P
  ? `populate path of "${Prefix}" must be a literal`
  : WalkPopulate<T, P> extends infer W
    ? true extends W
      ? never
      : `invalid populate path "${Prefix}${P}": ${W & string}`
    : never;

/**
 * The message for an invalid `select` of a populate element, `never` when valid.
 *
 * @typeParam Target - The populated model.
 * @typeParam S - The `select` given.
 * @typeParam Where - The path used in the message.
 * @example
 * type A = SelectErrors<User, { nme: 1 }, "author">; // `select of "author": unknown field "nme"`
 */
type SelectErrors<Target, S, Where extends string> =
  S extends Projection<Target>
    ? Exclude<keyof S & string, keyof Projection<Target>> extends infer Bad extends string
      ? [Bad] extends [never]
        ? ProjectionModeCheck<S> extends { readonly "projection error": infer M extends string }
          ? `select of "${Where}": ${M}`
          : never
        : `select of "${Where}": unknown field "${Bad}"`
      : never
    : `select of "${Where}" is not a projection of the populated model`;

/**
 * The message for an invalid `match` filter of a populate element, `never` when valid.
 *
 * @typeParam Target - The populated model.
 * @typeParam M - The filter given.
 * @typeParam Where - The path used in the message.
 * @example
 * type A = FilterErrors<User, { nme: "a" }, "author">; // `match of "author": unknown field "nme"`
 */
type FilterErrors<Target, M, Where extends string> =
  M extends Filter<Target>
    ? Exclude<keyof M & string, keyof Filter<Target>> extends infer Bad extends string
      ? [Bad] extends [never]
        ? never
        : `match of "${Where}": unknown field "${Bad}"`
      : never
    : `match of "${Where}" is not a valid filter of the populated model`;

/**
 * `match`: a filter of the target, or a function of the document returning one.
 *
 * @typeParam Target - The populated model.
 * @typeParam M - The filter or the function given.
 * @typeParam Where - The path used in the message.
 * @example
 * type A = MatchErrors<User, (post: Post) => { age: 1 }, "author">; // never
 */
type MatchErrors<Target, M, Where extends string> = M extends (document: never) => infer R
  ? FilterErrors<Target, R, Where>
  : FilterErrors<Target, M, Where>;

/**
 * The message for an invalid `options` of a populate element, `never` when valid.
 *
 * @typeParam Target - The populated model.
 * @typeParam O - The options given.
 * @typeParam Where - The path used in the message.
 * @example
 * type A = OptionErrors<User, { skp: 1 }, "author">; // `options of "author": unknown option "skp"`
 */
type OptionErrors<Target, O, Where extends string> =
  O extends PopulateQueryOptions<Target>
    ? Exclude<keyof O & string, keyof PopulateQueryOptions<Target>> extends infer Bad extends string
      ? [Bad] extends [never]
        ? never
        : `options of "${Where}": unknown option "${Bad}"`
      : never
    : `options of "${Where}" are not valid (sort by paths of the populated model, limit, skip)`;

/**
 * The lean document a `transform` receives, and the id: `(doc, id) => R` (`doc` is `null` for a missing document).
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate path.
 * @typeParam S - The projection given for the path.
 * @example
 * type A = TransformDoc<Post, "author", undefined>; // User | null
 */
export type TransformDoc<T, P extends string, S> = TransformDocBox<T, P, S>[0];
/**
 * The union of `TransformDoc` built inside a one-element tuple: read back with `[0]` it has no alias, so the
 * hover of the transform's parameter shows the document type (as `PopulatedBox` does for fields).
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate path.
 * @typeParam S - The projection given for the path.
 * @example
 * type A = TransformDocBox<Post, "author", undefined>; // [User | null]
 */
type TransformDocBox<T, P extends string, S> = [Populated<PopulateTargetOf<T, P>, S, never, true> | null];
/**
 * The id type of a `Ref<M, Id>` without its phantom model. Not by intersection inference (`infer Id &
 * RefMarker` also matches the marked type itself), by the id types a reference can have.
 *
 * @typeParam V - The reference type without its marker.
 * @example
 * type A = RefId<ObjectId>; // ObjectId
 * type B = RefId<string>; // string
 */
type RefId<V> = V extends ObjectId
  ? ObjectId
  : V extends UUID
    ? UUID
    : V extends string
      ? string
      : V extends number
        ? number
        : V extends bigint
          ? bigint
          : V;

/**
 * The id a `transform` receives: the reference's id type (a virtual: its local value, `unknown`).
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate path.
 * @example
 * type A = TransformId<Post, "author">; // ObjectId
 */
export type TransformId<T, P extends string> =
  PopulateFieldOf<T, P> extends infer F ? ([RefModel<F>] extends [never] ? unknown : RefId<Unbranded<Elem<F>>>) : never;

/**
 * A `transform` given without a contextual type (the list form, a nested object) must accept the document.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate path.
 * @typeParam S - The projection given for the path.
 * @typeParam F - The `transform` given.
 * @typeParam Where - The path used in the message.
 * @example
 * type A = TransformErrors<Post, "author", undefined, (doc: User | null, id: unknown) => string, "author">; // never
 */
type TransformErrors<T, P extends string, S, F, Where extends string> = F extends (doc: infer D, id: never) => unknown
  ? [TransformDoc<T, P, S>] extends [D]
    ? never
    : `transform of "${Where}": its first parameter must accept the populated document or null`
  : `transform of "${Where}" must be (doc, id) => value`;

/**
 * Options a `count` virtual refuses (it gives a number).
 *
 * @typeParam Field - The stored field type.
 * @typeParam P - The populate object.
 * @typeParam Where - The path used in the message.
 * @example
 * type A = CountErrors<VirtualRef<Post, false, true>, { path: "n"; select: 1 }, "n">;
 * // `a count virtual "n" takes no "select"`
 */
type CountErrors<Field, P, Where extends string> =
  VirtualRefCount<Field> extends true
    ? Exclude<keyof P & string, "path" | "match"> extends infer Bad extends string
      ? [Bad] extends [never]
        ? never
        : `a count virtual "${Where}" takes no "${Bad}"`
      : never
    : never;

/**
 * Every problem of one populate object: path, unknown options, `select`, `match`, `options`, `transform`,
 * count virtuals, `retainNullValues` on a virtual and nested `populate`.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate object.
 * @typeParam Prefix - The path of the enclosing populate, with its trailing dot.
 * @example
 * type A = ObjectErrors<Post, { path: "author"; select: { nme: 1 } }, "">; // `select of "author": unknown field "nme"`
 */
type ObjectErrors<T, P, Prefix extends string> = P extends { readonly path: infer Pa extends string }
  ? string extends Pa
    ? `populate path of "${Prefix}" must be a literal`
    : PopulateTargetOf<T, Pa> extends infer Target
      ?
          | PathErrors<T, Pa, Prefix>
          | (Exclude<keyof P, ObjectKey> extends infer K extends string
              ? [K] extends [never]
                ? never
                : `unknown populate option "${K}" for "${Prefix}${Pa}"`
              : never)
          | ([Target] extends [never]
              ? never
              :
                  | (P extends { readonly select: infer S } ? SelectErrors<Target, S, `${Prefix}${Pa}`> : never)
                  | (P extends { readonly match: infer M } ? MatchErrors<Target, M, `${Prefix}${Pa}`> : never)
                  | (P extends { readonly options: infer O } ? OptionErrors<Target, O, `${Prefix}${Pa}`> : never)
                  | (P extends { readonly transform: infer F }
                      ? TransformErrors<
                          T,
                          Pa,
                          P extends { readonly select: infer S } ? S : undefined,
                          F,
                          `${Prefix}${Pa}`
                        >
                      : never)
                  | CountErrors<PopulateFieldOf<T, Pa>, P, `${Prefix}${Pa}`>
                  | (P extends { readonly retainNullValues: true }
                      ? IsVirtualRef<PopulateFieldOf<T, Pa>> extends true
                        ? `retainNullValues of "${Prefix}${Pa}": a virtual has no positions to keep`
                        : never
                      : never)
                  | (P extends { readonly populate: infer N } ? SpecErrors<Target, N, `${Prefix}${Pa}.`> : never))
      : never
  : "a populate object needs a string `path`";

/**
 * The problems of a populate spec: a path string, a list of specs, or an object.
 *
 * @typeParam T - The entity type.
 * @typeParam N - The populate spec.
 * @typeParam Prefix - The path of the enclosing populate, with its trailing dot.
 * @example
 * type A = SpecErrors<Post, "title", "">; // `invalid populate path "title": ...`
 * type B = SpecErrors<Post, ["author"], "">; // never
 */
type SpecErrors<T, N, Prefix extends string> = N extends string
  ? PathErrors<T, N, Prefix>
  : N extends readonly unknown[]
    ? SpecErrors<T, N[number], Prefix> | DuplicateErrors<N, Prefix>
    : ObjectErrors<T, N, Prefix>;

/**
 * The path of one element of a populate list: the string itself, or the `path` of an object.
 *
 * @typeParam S - The element.
 * @example
 * type A = SpecPath<{ path: "author" }>; // "author"
 */
type SpecPath<S> = S extends string ? S : S extends { readonly path: infer P extends string } ? P : never;

/**
 * The paths a populate list gives more than once (the runtime refuses them with a `QueryError`).
 *
 * @typeParam L - The list, as a tuple.
 * @typeParam Prefix - The path of the enclosing populate, with its trailing dot.
 * @typeParam Seen - The paths of the elements before.
 * @example
 * type A = DuplicateErrors<["author", { path: "author" }], "">; // `populate "author": the path is given twice`
 */
type DuplicateErrors<L, Prefix extends string, Seen extends string = never> = L extends readonly [
  infer Head,
  ...infer Rest,
]
  ?
      | (SpecPath<Head> extends infer P extends string
          ? [P] extends [never]
            ? never
            : [P] extends [Seen]
              ? `populate "${Prefix}${P}": the path is given twice`
              : never
          : never)
      | DuplicateErrors<Rest, Prefix, Seen | SpecPath<Head>>
  : never;

/**
 * `unknown` when `Errors` is empty, otherwise a required property that carries the messages.
 *
 * @typeParam Errors - The union of error messages.
 * @example
 * type A = PopulateReport<never>; // unknown
 * type B = PopulateReport<"bad path">; // { readonly "populate error": "bad path" }
 */
export type PopulateReport<Errors> = [Errors] extends [never] ? unknown : { readonly "populate error": Errors };

/**
 * Check of the object form `populate({ path, … })`.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate object.
 * @example
 * type A = PopulateObjectCheck<Post, { path: "author" }>; // unknown
 */
export type PopulateObjectCheck<T, P> = PopulateReport<ObjectErrors<T, P, "">>;

/**
 * Check of the list form `populate(["a", { path: "b", … }])`.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The list of specs.
 * @example
 * type A = PopulateListCheck<Post, ["author", { path: "comments" }]>; // unknown
 */
export type PopulateListCheck<T, P extends readonly unknown[]> = PopulateReport<
  SpecErrors<T, P[number], ""> | DuplicateErrors<P, "">
>;

/**
 * The loose shape the object form is inferred against (the check does the rest).
 *
 * @example
 * const spec: PopulateObject = { path: "author", select: { name: 1 }, justOne: true };
 */
export interface PopulateObject {
  /** The path to populate. */
  readonly path: string;
  /** The projection of the populated documents. */
  readonly select?: object;
  /** A filter of the populated model, or a function of the document giving one (a query per document). */
  readonly match?: object;
  /** Options of the populate query: `sort`, `limit`, `skip`. */
  readonly options?: object;
  /** Nested populate of the populated documents. */
  readonly populate?: string | PopulateObject | readonly (string | PopulateObject)[];
  /** Forces one document (`true`) or a list (`false`) instead of what the field type implies. */
  readonly justOne?: boolean;
  /** Keeps a `null` in the list for each reference that found nothing. */
  readonly retainNullValues?: boolean;
  /** At most this many documents per owner. */
  readonly perDocumentLimit?: number;
  /**
   * A reference (or a `justOne` virtual) that finds no document is an error (`DocumentNotFoundError`)
   * instead of `null`/a missing element — the type then has no `| null` (like `orFail` for a query). A
   * stored `null` stays `null`: it is not a reference.
   */
  readonly required?: boolean;
  /**
   * `clone: true` gives EVERY owner its own copy of a populated document. Off by default: a document
   * found for several owners is then ONE shared object — a change made through one owner is visible
   * through all of them, and `$save()` of it (tracking is per object) saves whatever any of them changed.
   */
  readonly clone?: boolean;
  /** `(doc, id) => value` (typed from the path in the single-object form; annotate it in a list or nested object). */
  readonly transform?: (doc: never, id: never) => unknown;
}

/**
 * The options of the single-object form once its path `P` is inferred: `transform` is typed by the
 * populated document (`doc`, lean, `null` when not found; `S` is the select) and the reference's id, so an
 * unannotated callback gets its types. The other options are checked by `PopulateObjectCheck`.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The populate path.
 * @typeParam S - The projection given for the path.
 * @example
 * const spec: PopulateObjectSpec<Post, "author", undefined> = { transform: (doc, id) => doc?.name ?? String(id) };
 */
export type PopulateObjectSpec<T, P extends string, S> = Omit<PopulateObject, "path" | "transform" | "match"> & {
  /**
   * A filter of the populated model, or a function of the document being populated (its lean form, before
   * this path is populated: ids) giving one — then each document gets its own query.
   */
  readonly match?: object | ((document: Lean<T>) => object);
  /** The `transform`, typed by the populated document and the reference's id. */
  readonly transform?: (doc: TransformDocBox<T, P, S>[0], id: TransformId<T, P>) => unknown;
};

/**
 * The parameter of the ONE `populate`/`$populate` signature: the argument may be a path, a populate object or a
 * list of them, and the parameter is computed from what was inferred (`Ps` for a path, `Pa`/`Sel`/`O` for an
 * object, `L` for a list). A wrong argument gives one compiler error whose parameter type carries the message
 * (`"Invalid populate path …"`, a `populate error` property), not an "No overload matches" wall. Overloads
 * could not do that: the compiler lists every failed overload, and the useful text sat in one of them.
 *
 * `Pa` is `never` unless the argument is an object (its path is the only thing inferred from `path`); then the
 * object member is the loose `PopulateObject`, so a wrong argument of any other kind reads "not assignable to
 * `PopulateObject | …`".
 *
 * @typeParam T - The entity type.
 * @typeParam Ps - The path, when the argument is a string.
 * @typeParam Pa - The path of the populate object, when the argument is an object.
 * @typeParam Sel - The `select` of the populate object.
 * @typeParam O - The other options of the populate object.
 * @typeParam L - The list, when the argument is a list.
 * @example
 * type A = PopulateArgument<Post, "author", never, undefined, never, never>; // "author"
 * type B = PopulateArgument<Post, "title", never, undefined, never, never>; // `Invalid populate path "title": …`
 */
export type PopulateArgument<T, Ps, Pa extends string, Sel, O, L> = [T] extends [unknown]
  ? /* a conditional that always resolves: the union is printed in an error, not as the alias name */
      | (Ps extends string ? CheckedPopulatePath<T, Ps> : never)
      | ([Pa] extends [never]
          ? PopulateObject
          : { readonly path: CheckedPopulatePath<T, Pa>; readonly select?: Sel } & O &
              (0 extends 1 & Pa ? unknown : PopulateObjectCheck<T, { readonly path: Pa } & O>))
      | (L extends readonly (string | PopulateObject)[]
          ? L & (0 extends 1 & L ? unknown : PopulateListCheck<T, L>)
          : never)
  : never;

/**
 * The population entries of a call of the merged `populate` signature: those of the path, of the object or of the
 * list, by what the argument was (see {@link PopulateArgument}).
 *
 * @typeParam Ps - The path, when the argument is a string.
 * @typeParam Pa - The path of the populate object, when the argument is an object.
 * @typeParam O - The other options of the populate object.
 * @typeParam L - The list, when the argument is a list.
 * @example
 * type A = PopulateArgumentEntries<"author", never, never, never>; // the entry of "author"
 */
export type PopulateArgumentEntries<Ps, Pa extends string, O, L> = [Pa] extends [never]
  ? [Ps] extends [string]
    ? ExtractPopulationEntries<Ps>
    : [L] extends [readonly unknown[]]
      ? ExtractPopulationEntries<L>
      : never
  : ExtractPopulationEntries<{ readonly path: Pa } & O>;
