import type { Binary, Decimal128, ObjectId, Timestamp } from "mongodb";
import type { ExprFor } from "../aggregate/expressions/public.ts";
import type { BsonTypeAlias } from "../bson/bson-type-table.ts";
import type { IsPlainObject, OpaqueValue } from "../bson/opaque-value.ts";
import type { BsonJsonSchema } from "../schema/json-schema/json-schema-generator.ts";
import type { LeanOf, StringInputOf } from "./document-forms.ts";
import type { GeoIntersectsOperand, GeoJsonLike, GeoNearOperand, GeoWithinOperand } from "./geo-json.ts";
import type { IsMapEntryKey } from "./path-check.ts";
import type { MaxPathDepth } from "./paths.ts";
import type { DataKeys } from "./schema-paths.ts";
import type { Dec, NonEmptyArray } from "./type-utils.ts";

/*
 * `Filter<T>`: every MongoDB query operator, tied to the type of the field it applies to.
 * There is no `any` and no index signature for unknown keys (a typo in a field or an operator is an
 * error), no `$where`, and `$expr` is accepted only through the typed pipeline expressions.
 *
 * - `null` is a value only where the path can hold `null` (a nullable field, or a nullable segment on
 *   the way: `{"address.zip": null}` also matches `address: null`). An optional (`?`) field is not
 *   nullable: "absent" is `$exists: false`.
 * - `undefined` is never a value: the operand types exclude it (with `exactOptionalPropertyTypes` the
 *   compiler refuses `{ age: undefined }`; the generic check of `path-check.ts` refuses it everywhere).
 * - Values are the STORED form (`LeanOf`): a `Map` field compares as a record, a subdocument as its
 *   lean data, an id as the id; an int64 also takes its decimal string (cast to int64 on the way).
 * - Read paths go through arrays (`revisions.note`); a numeric segment addresses one element
 *   (`tags.0`, `revisions.1.note`); a `Map` entry is `counters.visits`.
 */

/**
 * A `$type` operand: a BSON type alias, `"number"` (any numeric type) or a BSON type number.
 *
 * @example
 * const a: TypeOperand = "string";
 * const b: TypeOperand = 16; // int32
 */
export type TypeOperand =
  | BsonTypeAlias
  | "number"
  | 1
  | 2
  | 3
  | 4
  | 5
  | 7
  | 8
  | 9
  | 10
  | 11
  | 16
  | 17
  | 18
  | 19
  | -1
  | 127;

/**
 * Values with a meaningful order (`$gt`, `$lt`, `$min`/`$max` of update, sort).
 *
 * @example
 * const a: Orderable = 5;
 * const b: Orderable = new Date();
 */
export type Orderable = number | bigint | string | Date | ObjectId | Decimal128 | Timestamp | Binary;

/**
 * A value compared with a stored `V`: its stored form, or its string form for an int64, an `ObjectId` and a
 * `UUID` ({@link StringInputOf}).
 *
 * @typeParam V - The field's value type.
 * @example
 * type A = CompareOf<bigint>; // bigint | Int64String
 * type B = CompareOf<ObjectId>; // ObjectId | string
 * type C = CompareOf<string>; // string
 */
export type CompareOf<V> = LeanOf<V> | StringInputOf<V>;

/**
 * A bitmask operand of `$bitsAllSet`/`$bitsAnySet`/`$bitsAllClear`/`$bitsAnyClear`.
 *
 * @example
 * const mask: BitmaskOperand = [0, 3]; // bit positions
 */
export type BitmaskOperand = number | readonly number[] | Binary;

/**
 * Operators available on every path: equality, membership, presence and BSON type.
 *
 * @typeParam V - The operand type for `$eq`, `$ne`, `$in` and `$nin`.
 * @example
 * type E = EqualityOperators<string>; // { $eq?: string; $in?: readonly string[]; $exists?: boolean; ... }
 */
interface EqualityOperators<V> {
  /** Equals the value. */
  $eq?: V;
  /** Does not equal the value. */
  $ne?: V;
  /** Equals any of the values. */
  $in?: readonly V[];
  /** Equals none of the values. */
  $nin?: readonly V[];
  /** The field is present (`true`) or absent (`false`). */
  $exists?: boolean;
  /** The field has one of the given BSON types. */
  $type?: TypeOperand | NonEmptyArray<TypeOperand>;
}

/**
 * The range operators of an ordered value.
 *
 * @typeParam V - The operand type.
 * @example
 * type C = ComparisonOperators<number>; // { $gt?: number; $gte?: number; $lt?: number; $lte?: number }
 */
interface ComparisonOperators<V> {
  /** Greater than. */
  $gt?: V;
  /** Greater than or equal. */
  $gte?: V;
  /** Less than. */
  $lt?: V;
  /** Less than or equal. */
  $lte?: V;
}

/**
 * The operators of a string value.
 *
 * @example
 * const s: StringOperators = { $regex: "^ab", $options: "i" };
 */
interface StringOperators {
  /** Matches the regular expression. */
  $regex?: RegExp | string;
  /** Regex flags for a string `$regex` (`i`, `m`, `x`, `s`, `u`). */
  $options?: string;
}

/**
 * The operators of an integer-like value: modulo and bit tests.
 *
 * @typeParam N - The number type of the divisor and the remainder.
 * @example
 * const m: IntegerOperators<number> = { $mod: [4, 0] };
 */
interface IntegerOperators<N> {
  /** `value % divisor === remainder`. */
  $mod?: readonly [divisor: N, remainder: N];
  /** All the given bits are set. */
  $bitsAllSet?: BitmaskOperand;
  /** Any of the given bits is set. */
  $bitsAnySet?: BitmaskOperand;
  /** All the given bits are clear. */
  $bitsAllClear?: BitmaskOperand;
  /** Any of the given bits is clear. */
  $bitsAnyClear?: BitmaskOperand;
}

/**
 * The bit-test operators of a `Binary` value.
 *
 * @example
 * const b: BinaryBitOperators = { $bitsAllSet: [1, 5] };
 */
interface BinaryBitOperators {
  /** All the given bits are set. */
  $bitsAllSet?: BitmaskOperand;
  /** Any of the given bits is set. */
  $bitsAnySet?: BitmaskOperand;
  /** All the given bits are clear. */
  $bitsAllClear?: BitmaskOperand;
  /** Any of the given bits is clear. */
  $bitsAnyClear?: BitmaskOperand;
}

/**
 * Geospatial operators: on GeoJSON fields and on legacy coordinate pairs (`number[]`).
 *
 * @example
 * const g: GeoOperators = { $near: { $geometry: { type: "Point", coordinates: [0, 0] }, $maxDistance: 100 } };
 */
export interface GeoOperators {
  /** The shape lies inside the given region. */
  $geoWithin?: GeoWithinOperand;
  /** The shape intersects the given geometry. */
  $geoIntersects?: GeoIntersectsOperand;
  /** Sorted by distance from a point. */
  $near?: GeoNearOperand;
  /** As `$near`, on a sphere. */
  $nearSphere?: GeoNearOperand;
  /** Legacy form: sibling of `$near: [x, y]`. */
  $minDistance?: number;
  /** Legacy form: sibling of `$near: [x, y]`. */
  $maxDistance?: number;
}

/**
 * `T` when `C` is not `never`, otherwise `unknown` (the neutral element of an intersection).
 *
 * @typeParam C - The condition: the members of a value type that an operator group applies to.
 * @typeParam T - The operator group to add.
 * @example
 * type A = If<string, StringOperators>; // StringOperators
 * type B = If<never, StringOperators>; // unknown
 */
type If<C, T> = [C] extends [never] ? unknown : T;

/**
 * The operators of a scalar value `V` (without `null`); `N` is `null` when the path is nullable.
 * Each group is added only for the members of `V` it applies to (a `string | number` union field gets
 * `$regex` for its strings and `$mod` for its numbers).
 *
 * @typeParam V - The scalar value type.
 * @typeParam N - `null` when the path is nullable, otherwise `never`.
 * @example
 * type A = ScalarOperators<number, never>; // $eq/$in/... + $gt/$lt/... + $mod/$bits* + $not
 * type B = ScalarOperators<boolean, never>; // equality group + $not only
 */
export type ScalarOperators<V, N> = EqualityOperators<CompareOf<V> | N> & ValueOperators<V, N>;

/**
 * {@link ScalarOperators} without the equality group (`$eq`/`$ne`/`$in`/`$nin`/`$exists`/`$type`): an array
 * field has ONE equality group whose operand is an element OR the whole array (intersecting the element
 * group with the whole-array group made `$in: ["a", "b"]` on a `string[]` field a type error, because only
 * `[]` fitted both).
 *
 * @typeParam V - The value type (or the element type of an array).
 * @typeParam N - `null` when the path is nullable, otherwise `never`.
 * @example
 * type A = ValueOperators<string, never>; // StringOperators & ComparisonOperators<string> & { $not? }
 */
type ValueOperators<V, N> = If<Extract<V, Orderable>, ComparisonOperators<CompareOf<Extract<V, Orderable>>>> &
  If<Extract<V, string>, StringOperators> &
  If<Extract<V, number>, IntegerOperators<number>> &
  If<Extract<V, bigint>, IntegerOperators<bigint | number>> &
  If<Extract<V, Binary>, BinaryBitOperators> &
  If<Extract<V, GeoJsonLike>, GeoOperators> & {
    $not?: NotOperand<V, N>;
  };

/**
 * The operand of `$not`: the operators of the value without `$not` itself, or a `RegExp` for strings.
 *
 * @typeParam V - The scalar value type.
 * @typeParam N - `null` when the path is nullable, otherwise `never`.
 * @example
 * type A = NotOperand<string, never>; // Omit<ScalarOperators<string, never>, "$not"> | RegExp
 */
type NotOperand<V, N> = Omit<ScalarOperators<V, N>, "$not"> | ([Extract<V, string>] extends [never] ? never : RegExp);

/**
 * Array-only operators (`$all`, `$size`, `$elemMatch`) over the element type `E`.
 *
 * @typeParam E - The array element type.
 * @example
 * const a: ArrayOperators<string> = { $all: ["a", "b"], $size: 2 };
 */
export interface ArrayOperators<E> {
  /** The array contains all of the values. */
  $all?: readonly CompareOf<E>[];
  /** The array has this length. */
  $size?: number;
  /** At least one element matches the condition. */
  $elemMatch?: ElemMatchOperand<E>;
}

/**
 * `$elemMatch`: a filter of an embedded element, operators of a scalar one.
 *
 * @typeParam E - The array element type.
 * @example
 * type A = ElemMatchOperand<{ note: string }>; // Filter<{ note: string }>
 * type B = ElemMatchOperand<number>; // ScalarOperators<number, never>
 */
export type ElemMatchOperand<E> =
  true extends IsPlainObject<E> ? Filter<Extract<E, object>> : ScalarOperators<E, never>;

/**
 * The condition of one path whose value type is `V` (`null` included when the path is nullable):
 * a value, an operator object, a `RegExp` for strings; for arrays also an element or the whole array.
 *
 * @typeParam V - The value type at the path.
 * @example
 * type A = Condition<number>; // number | ScalarOperators<number, never>
 * type B = Condition<string[]>; // string | readonly string[] | RegExp | array operators | ...
 */
export type Condition<V> = [Extract<NonNullable<V>, readonly unknown[]>] extends [never]
  ? ScalarCondition<NonNullable<V>, Extract<V, null>>
  :
      | ArrayCondition<ElementOf<NonNullable<V>>, Extract<V, null>>
      | ScalarCondition<Exclude<NonNullable<V>, readonly unknown[]>, Extract<V, null>>;

/**
 * The non-null element type of an array type; `never` for a non-array.
 *
 * @typeParam V - The candidate array type.
 * @example
 * type A = ElementOf<string[]>; // string
 */
type ElementOf<V> = V extends readonly (infer E)[] ? NonNullable<E> : never;

/**
 * The condition of a scalar path: a value, `null` when nullable, an operator object, a `RegExp` for strings.
 *
 * @typeParam V - The scalar value type (without `null`).
 * @typeParam N - `null` when the path is nullable, otherwise `never`.
 * @example
 * type A = ScalarCondition<string, null>; // string | null | ScalarOperators<string, null> | RegExp
 */
type ScalarCondition<V, N> = [V] extends [never]
  ? never
  : CompareOf<V> | N | ScalarOperators<V, N> | ([Extract<V, string>] extends [never] ? never : RegExp);

/**
 * The condition of an array path (element type `E`): an element, the whole array, or operators — the equality group
 * takes an element or a whole array (server semantics: `$in` matches when an element, or the array itself, is in
 * the list), the value operators apply to the elements, plus the array-only operators.
 *
 * @typeParam E - The array element type.
 * @typeParam N - `null` when the path is nullable, otherwise `never`.
 * @example
 * type A = ArrayCondition<string, never>; // string | readonly string[] | RegExp | { $all?, $size?, $in?, ... }
 */
type ArrayCondition<E, N> =
  | CompareOf<E>
  | readonly CompareOf<E>[]
  | N
  | (EqualityOperators<CompareOf<E> | N | readonly CompareOf<E>[]> &
      ValueOperators<E, N> &
      ArrayOperators<E> &
      If<Extract<E, number>, GeoOperators>)
  | ([Extract<E, string>] extends [never] ? never : RegExp);

/*
 * Paths of a filter
 */

/**
 * The innermost element type of nested arrays (`string[][]` gives `string`); a non-array is unchanged.
 *
 * @typeParam V - The candidate array type.
 * @example
 * type A = Elem<number[][]>; // number
 */
type Elem<V> = V extends readonly (infer E)[] ? Elem<NonNullable<E>> : V;

/**
 * Prefixes every string of `Sub` with `K.`.
 *
 * @typeParam K - The prefix path.
 * @typeParam Sub - The sub-path union.
 * @example
 * type A = Join<"a", "b" | "c">; // "a.b" | "a.c"
 */
type Join<K extends string, Sub> = Sub extends string ? `${K}.${Sub}` : never;

/**
 * The keys a filter names: read paths ({@link Paths} of `paths.ts`) plus numeric element segments
 * after arrays (`tags.0`, `revisions.1.note`) and entries of `Map` fields (`counters.visits`).
 *
 * @typeParam T - The document type.
 * @typeParam D - The remaining recursion depth.
 * @example
 * type A = FilterPaths<{ tags: string[]; address: { zip: string } }>;
 * // "tags" | `tags.${number}` | "address" | "address.zip"
 */
export type FilterPaths<T, D extends number = MaxPathDepth> = T extends unknown
  ? D extends 0
    ? never
    : { [K in DataKeys<T>]: FilterSub<K, NonNullable<T[K]>, D> }[DataKeys<T>]
  : never;

/**
 * The filter paths contributed by one field `K` of type `V`: the key itself, plus, by kind of value, the
 * Map entries, the array elements and their fields, or the fields of a subdocument.
 *
 * @typeParam K - The field path.
 * @typeParam V - The field's non-null value type.
 * @typeParam D - The remaining recursion depth.
 * @example
 * type A = FilterSub<"tags", string[], 5>; // "tags" | `tags.${number}`
 * type B = FilterSub<"counters", Map<string, number>, 5>; // "counters" | `counters.${string}`
 */
type FilterSub<K extends string, V, D extends number> =
  V extends ReadonlyMap<string, unknown>
    ? K | `${K}.${string}`
    : V extends readonly unknown[]
      ? K | `${K}.${number}` | ElementSub<K, Elem<V>, D> | ElementSub<`${K}.${number}`, Elem<V>, D>
      : true extends IsPlainObject<V>
        ? K | Join<K, FilterPaths<Extract<V, object>, Dec[D]>>
        : K;

/**
 * The paths inside an array element: the fields of a subdocument element prefixed with `K`, else `never`.
 *
 * @typeParam K - The prefix (the array path, or the array path plus a numeric index).
 * @typeParam E - The element type.
 * @typeParam D - The remaining recursion depth.
 * @example
 * type A = ElementSub<"revisions", { note: string }, 5>; // "revisions.note"
 */
type ElementSub<K extends string, E, D extends number> =
  true extends IsPlainObject<E> ? Join<K, FilterPaths<Extract<E, object>, Dec[D]>> : never;

/**
 * The value type at a filter path, with `null` added when a segment ON THE WAY is nullable (the leaf
 * keeps its own `null`; an optional leaf does not become nullable).
 *
 * @typeParam T - The document type.
 * @typeParam P - The filter path.
 * @example
 * type A = FilterValue<{ address: { zip: string } | null }, "address.zip">; // string | null
 * type B = FilterValue<{ tags: string[] }, "tags.0">; // string
 */
export type FilterValue<T, P extends string> = T extends unknown
  ? P extends `${infer H}.${infer R}`
    ? H extends DataKeys<T>
      ? FilterStep<NonNullable<T[H]>, R> | Extract<T[H], null>
      : never
    : P extends DataKeys<T>
      ? Exclude<T[P], undefined>
      : never
  : never;

/**
 * One step of {@link FilterValue} through a container: a Map entry, an array element (by index or
 * transparently) or a subdocument field.
 *
 * @typeParam V - The non-null container type.
 * @typeParam R - The rest of the path below the container.
 * @example
 * type A = FilterStep<{ note: string }[], "note">; // string
 */
type FilterStep<V, R extends string> =
  V extends ReadonlyMap<string, infer M>
    ? R extends `${string}.${infer Rest}`
      ? FilterObject<NonNullable<M>, Rest> | Extract<M, null>
      : Exclude<M, undefined>
    : V extends readonly (infer E)[]
      ? R extends `${number}.${infer Rest}`
        ? FilterStep<NonNullable<E>, Rest> | Extract<E, null>
        : R extends `${number}`
          ? Exclude<E, undefined>
          : FilterStep<NonNullable<E>, R> | Extract<E, null>
      : FilterObject<V, R>;

/**
 * Descends into an object value; opaque values (`ObjectId`, `Date`, ...) have no inner paths.
 *
 * @typeParam V - The candidate object type.
 * @typeParam R - The rest of the path.
 * @example
 * type A = FilterObject<{ a: number }, "a">; // number
 * type B = FilterObject<Date, "a">; // never
 */
type FilterObject<V, R extends string> = V extends OpaqueValue ? never : V extends object ? FilterValue<V, R> : never;

/**
 * The field conditions of `T`: one optional key per filter path. With `Loose` (the generic constraint of
 * the builders) a Map-entry key (`badges.${string}`) and an array-index key (`tags.${number}`) take anything:
 * `path-check.ts` checks the key actually passed, including fields inside the Map value (`badges.gold.title`).
 * That is also what lets a dynamic filter with a string index signature (`Record<string, unknown>`) be assigned.
 *
 * @typeParam T - The document type.
 * @typeParam Loose - `true` for the generic builder constraint, `false` for the strict form.
 * @example
 * type A = FieldConditions<{ age: number }>; // { age?: Condition<number> }
 */
export type FieldConditions<in out T, in out Loose extends boolean = true> = {
  [P in FilterPaths<T>]?: Loose extends true
    ? IsMapEntryKey<P> extends true
      ? unknown
      : Record<never, never> extends Record<P, 1>
        ? unknown
        : Condition<FilterValue<T, P>>
    : Condition<FilterValue<T, P>>;
};

/**
 * Operators at the root of a filter.
 *
 * A type alias, not an interface: an interface carries an implicit `this` type parameter, and relating
 * `Filter<T>` to itself through the recursive `$and` then instantiated the whole tree (TS2589).
 *
 * @typeParam T - The document type.
 * @typeParam Loose - `true` for the generic builder constraint, `false` for the strict form.
 * @example
 * const r: RootOperators<{ age: number }> = { $or: [{ age: 1 }, { age: 2 }] };
 */
export type RootOperators<in out T, in out Loose extends boolean = true> = {
  /** All of the clauses (non-empty: `$and: []` is refused by the server). */
  $and?: NonEmptyArray<Filter<T, Loose>>;
  /** At least one of the clauses (non-empty). */
  $or?: NonEmptyArray<Filter<T, Loose>>;
  /** None of the clauses (non-empty). */
  $nor?: NonEmptyArray<Filter<T, Loose>>;
  /** An aggregation expression over the document, built with `fn.*`: `(f) => fn.gt(f.a, f.b)`. */
  $expr?: ExprFor<T>;
  /** Text search (needs a text index). */
  $text?: {
    $search: string;
    $language?: string;
    $caseSensitive?: boolean;
    $diacriticSensitive?: boolean;
  };
  /** Validates the document against a JSON Schema. */
  $jsonSchema?: BsonJsonSchema;
  /** Matches a random sample of documents at this rate (0..1). */
  $sampleRate?: number;
  /** A comment for the profiler and the logs. */
  $comment?: string;
};

/**
 * The field conditions and the root operators of `T` as one intersection.
 *
 * @typeParam T - The document type.
 * @typeParam Loose - `true` for the generic builder constraint, `false` for the strict form.
 * @example
 * type A = FilterShape<{ age: number }, false>; // { age?: Condition<number> } & RootOperators<...>
 */
type FilterShape<T, Loose extends boolean> = FieldConditions<T, Loose> & RootOperators<T, Loose>;

/**
 * A filter of documents of `T` (`Loose`: the generic constraint of the builders, see {@link FieldConditions}).
 *
 * It is one mapped object type with explicit invariance (`in out`), not the bare intersection
 * `FieldConditions & RootOperators`. The compiler infers and relates two instantiations of an alias by
 * its measured variance; measuring it for the intersection alias (and relating `Filter<T>` to
 * `Filter<T, true>`, distinct instantiations because the written arguments differ) walked the whole
 * recursive tree and hit TS2589 for a pre-typed `const f: Filter<User>` passed to `find`, `$match` or a
 * generic helper. With declared variance the arguments are compared directly.
 *
 * The compiler checks the keys it can see: a literal or an object typed with its fields. A dynamic filter —
 * `Record<string, unknown>`, or any object with an index signature, built at run time — is assignable to
 * `Filter<T>`, so its keys are checked only when the operation runs: an unknown path is a `StrictModeError`
 * (reason `"unknown-path"`) before anything is sent to the server.
 *
 * @typeParam T - The document type.
 * @typeParam Loose - `true` for the generic builder constraint, `false` for the strict form.
 * @example
 * type User = { name: string; age: number; tags: string[] };
 * const f: Filter<User> = { age: { $gte: 18 }, tags: "a", $or: [{ name: /^A/ }, { name: "Bob" }] };
 * // @ts-expect-error unknown field
 * const bad: Filter<User> = { nmae: "x" };
 */
export type Filter<in out T, in out Loose extends boolean = true> = {
  [K in keyof FilterShape<T, Loose>]?: FilterShape<T, Loose>[K];
};
