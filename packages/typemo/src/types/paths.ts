import type { IsPlainObject, OpaqueValue } from "../bson/opaque-value.ts";
import type { IsImmutable } from "./markers.ts";
import type { DataKeys } from "./schema-paths.ts";
import type { Dec } from "./type-utils.ts";

/*
 * Dotted paths of an entity. Shared with the aggregation builder.
 *
 * - READ paths (filter, sort, projection) go through embedded documents AND through arrays of
 *   embedded documents: MongoDB matches `{"revisions.note": x}` against every element.
 * - WRITE paths ($set, $inc, $push, …) never go through an array: the server refuses
 *   `{$set: {"revisions.note": x}}` (code 28 PathNotViable). An element is written through a
 *   positional token (`$`, `$[]`, `$[id]`, an index) at ANY depth.
 * - Opaque BSON values (`OpaqueValue`: ObjectId, Long, UUID, …) are leaves: no junk paths like
 *   `uuid.sub_type`.
 * - A union of embedded classes (`blocks: (TextBlock | ImageBlock)[]`, embedded discriminators) is
 *   walked member by member, so `blocks.url` exists when one member has `url`.
 * - A `Map` field is a leaf of the enumerated unions; its entries (`counters.visits`) and the fields
 *   inside its values (`badges.gold.title`) are CHECKED on the keys actually passed (`path-check.ts`),
 *   never enumerated (a template key `badges.${string}` would also swallow `badges.gold.title`).
 */

export type { IsPlainObject, OpaqueValue } from "../bson/opaque-value.ts";
export type { DataKeys } from "./schema-paths.ts";

/**
 * A readable error carried as a type (a bare literal intersected with a value would collapse to `never`).
 *
 * @typeParam Message - The error text.
 * @example
 * type E = PathError<"unknown field">; // { readonly error: "unknown field" }
 */
export interface PathError<Message extends string> {
  /** The error text. */
  readonly error: Message;
}

/**
 * Depth ceiling of enumerated read/write paths.
 *
 * @example
 * type D = MaxPathDepth; // 5
 */
export type MaxPathDepth = 5;

/**
 * The array element (through nested arrays), the value itself otherwise.
 *
 * @typeParam V - The field type.
 * @example
 * type A = Elem<string[][]>; // string
 */
type Elem<V> = V extends readonly (infer E)[] ? Elem<NonNullable<E>> : V;

/**
 * Joins a key and a sub-path with a dot; a non-string sub-path yields `never`.
 *
 * @typeParam K - The key.
 * @typeParam Sub - The sub-path union.
 * @example
 * type A = Join<"a", "b" | "c">; // "a.b" | "a.c"
 */
type Join<K extends string, Sub> = Sub extends string ? `${K}.${Sub}` : never;

/**
 * Every READ path of `T`: data keys (no methods, no `Computed`/`VirtualValue`/`VirtualRef`) and
 * dotted paths through embedded documents and arrays of them, `D` levels deep (default 5). Unions of
 * embedded classes contribute the paths of every member.
 *
 * @typeParam T - The entity type.
 * @typeParam D - The remaining depth.
 * @example
 * type A = Paths<{ name: string; tags: { label: string }[] }>; // "name" | "tags" | "tags.label"
 */
export type Paths<T, D extends number = MaxPathDepth> = T extends unknown
  ? D extends 0
    ? never
    : { [K in DataKeys<T>]: ReadSub<K, Elem<NonNullable<T[K]>>, D> }[DataKeys<T>]
  : never;

/**
 * The read paths of one key: the key itself, plus its sub-paths when its value is an embedded document.
 *
 * @typeParam K - The key.
 * @typeParam V - The value type (arrays already unwrapped).
 * @typeParam D - The remaining depth.
 * @example
 * type A = ReadSub<"address", { zip: string }, 5>; // "address" | "address.zip"
 * type B = ReadSub<"name", string, 5>; // "name"
 */
type ReadSub<K extends string, V, D extends number> =
  true extends IsPlainObject<V> ? K | Join<K, Paths<Extract<V, object>, Dec[D]>> : K;

/**
 * The type at a READ path `P` of `T` (filter semantics): through an array the ELEMENT type, a numeric
 * segment after an array is an element, a segment after a `Map` field is a key (its value type). The
 * leaf keeps its own `null`/`undefined`; `never` when `P` is not a path.
 *
 * @typeParam T - The entity type.
 * @typeParam P - The dotted path.
 * @example
 * type A = PathValue<{ tags: { label: string }[] }, "tags.label">; // string
 * type B = PathValue<{ tags: string[] }, "tags.0">; // string
 * type C = PathValue<{ name: string }, "nope">; // never
 */
export type PathValue<T, P extends string> = T extends unknown
  ? P extends `${infer H}.${infer R}`
    ? H extends DataKeys<T>
      ? Descend<NonNullable<T[H]>, R>
      : never
    : P extends DataKeys<T>
      ? T[P]
      : never
  : never;

/**
 * Walks the rest `R` of a read path into value `V`: a Map takes a key, an array an element (with or
 * without an index), an object continues as a path.
 *
 * @typeParam V - The value reached so far.
 * @typeParam R - The remaining path.
 * @example
 * type A = Descend<Map<string, number>, "visits">; // number
 * type B = Descend<{ label: string }[], "0.label">; // string
 */
type Descend<V, R extends string> =
  V extends ReadonlyMap<string, infer M>
    ? R extends `${string}.${infer Rest}`
      ? DescendObject<NonNullable<M>, Rest>
      : M
    : V extends readonly (infer E)[]
      ? R extends `${number}.${infer Rest}`
        ? Descend<NonNullable<E>, Rest>
        : R extends `${number}`
          ? E
          : Descend<NonNullable<E>, R>
      : DescendObject<V, R>;

/**
 * Continues a read path inside an object value; opaque BSON values have no paths.
 *
 * @typeParam V - The object value.
 * @typeParam R - The remaining path.
 * @example
 * type A = DescendObject<{ zip: string }, "zip">; // string
 * type B = DescendObject<ObjectId, "sub_type">; // never
 */
type DescendObject<V, R extends string> = V extends OpaqueValue ? never : V extends object ? PathValue<V, R> : never;

/* ---- write paths ---- */

/**
 * A positional token of an update path: `$` (first match), `$[]` (all), `$[id]` (arrayFilters), an index.
 *
 * @example
 * const a: PositionToken = "$[]";
 * const b: PositionToken = "$[item]";
 * const c: PositionToken = "2";
 */
export type PositionToken = "$" | "$[]" | `$[${string}]` | `${number}`;

/**
 * Data keys of `T` that may be written: immutable ones only for `$setOnInsert` (`WithImmutable`). Below the
 * root (`Nested`), `_id` is writable: `immutable` of `_id` binds the root `_id` only.
 *
 * @typeParam T - The entity type.
 * @typeParam WithImmutable - Whether immutable keys are included (`$setOnInsert`).
 * @typeParam Nested - Whether `T` is below the root.
 * @example
 * type A = WritableKeys<{ name: string; createdAt: Immutable<Date> }>; // "name"
 * type B = WritableKeys<{ name: string; createdAt: Immutable<Date> }, true>; // "name" | "createdAt"
 */
export type WritableKeys<
  T,
  WithImmutable extends boolean = false,
  Nested extends boolean = false,
> = WithImmutable extends true
  ? DataKeys<T>
  : {
      [K in DataKeys<T>]-?: IsImmutable<T[K]> extends true
        ? Nested extends true
          ? K extends "_id"
            ? K
            : never
          : never
        : K;
    }[DataKeys<T>];

/**
 * Every WRITE path of `T`: keys, dotted paths into embedded documents, positional paths into arrays
 * at any depth (`revisions.$[r].diff.files.$[].lines`), Map entries (`counters.${string}`; fields inside
 * a Map value are checked on the passed keys). Never through an array without a token.
 * Immutable fields (and everything below them) are excluded unless `WithImmutable`.
 *
 * @typeParam T - The entity type.
 * @typeParam WithImmutable - Whether immutable keys are included.
 * @typeParam D - The remaining depth.
 * @typeParam Nested - Whether `T` is below the root.
 * @example
 * type A = WritePaths<{ name: string; items: { qty: number }[] }>;
 * // "name" | "items" | `items.${PositionToken}` | `items.${PositionToken}.qty`
 */
export type WritePaths<
  T,
  WithImmutable extends boolean = false,
  D extends number = MaxPathDepth,
  Nested extends boolean = false,
> = T extends unknown
  ? D extends 0
    ? never
    : { [K in WritableKeys<T, WithImmutable, Nested>]: WriteSub<K, NonNullable<T[K]>, D, WithImmutable> }[WritableKeys<
        T,
        WithImmutable,
        Nested
      >]
  : never;

/**
 * The write paths of one key: a Map takes any entry, an array continues through a positional token, an
 * embedded document through its own write paths.
 *
 * @typeParam K - The key (or key plus positional token).
 * @typeParam V - The value type.
 * @typeParam D - The remaining depth.
 * @typeParam WithImmutable - Whether immutable keys are included.
 * @example
 * type A = WriteSub<"counters", Map<string, number>, 5, false>; // "counters" | `counters.${string}`
 */
type WriteSub<K extends string, V, D extends number, WithImmutable extends boolean> =
  V extends ReadonlyMap<string, unknown>
    ? K | `${K}.${string}`
    : V extends readonly (infer E)[]
      ? K | WriteSub<`${K}.${PositionToken}`, NonNullable<E>, D, WithImmutable>
      : true extends IsPlainObject<V>
        ? K | Join<K, WritePaths<Extract<V, object>, WithImmutable, Dec[D], true>>
        : K;

/**
 * The value type written at a WRITE path `P` (positional token → element; the leaf keeps its `null`).
 *
 * @typeParam T - The entity type.
 * @typeParam P - The dotted write path.
 * @example
 * type A = WriteValue<{ items: { qty: number }[] }, "items.$[].qty">; // number
 * type B = WriteValue<{ items: { qty: number }[] }, "items.qty">; // never (an array needs a token)
 */
export type WriteValue<T, P extends string> = T extends unknown
  ? P extends `${infer H}.${infer R}`
    ? H extends DataKeys<T>
      ? WriteStep<NonNullable<T[H]>, R>
      : never
    : P extends DataKeys<T>
      ? T[P]
      : never
  : never;

/**
 * Walks the rest `R` of a write path into value `V`: a Map takes a key, an array needs a positional
 * token, an object continues as a path.
 *
 * @typeParam V - The value reached so far.
 * @typeParam R - The remaining path.
 * @example
 * type A = WriteStep<{ qty: number }[], "$[].qty">; // number
 */
type WriteStep<V, R extends string> =
  V extends ReadonlyMap<string, infer M>
    ? R extends `${string}.${infer Rest}`
      ? WriteObject<NonNullable<M>, Rest>
      : M
    : V extends readonly (infer E)[]
      ? R extends `${PositionToken}.${infer Rest}`
        ? WriteStep<NonNullable<E>, Rest>
        : R extends PositionToken
          ? E
          : never
      : WriteObject<V, R>;

/**
 * Continues a write path inside an object value; opaque BSON values have no paths.
 *
 * @typeParam V - The object value.
 * @typeParam R - The remaining path.
 * @example
 * type A = WriteObject<{ zip: string }, "zip">; // string
 */
type WriteObject<V, R extends string> = V extends OpaqueValue ? never : V extends object ? WriteValue<V, R> : never;
