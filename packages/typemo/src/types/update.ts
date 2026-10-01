import type { Decimal128, Timestamp } from "mongodb";
import type { IsPlainObject } from "../bson/opaque-value.ts";
import type { InputOf, Int64String, LeanOf } from "./document-forms.ts";
import type { CompareOf, Condition, Filter, FilterPaths, FilterValue, Orderable } from "./filter.ts";
import type { IsMapEntryKey, IsWide } from "./path-check.ts";
import type { WritePaths, WriteValue } from "./paths.ts";
import type { Dec } from "./type-utils.ts";

/*
 * `Update<T>`: every update operator on the WRITE paths of `T` (`paths.ts`): never through an array
 * without a positional token, positional tokens at any depth, immutable fields only in `$setOnInsert`
 * (the only place they are legal), no root `_id` (server code 66). `null` is accepted in `$set` for
 * nullable paths; `$inc`/`$mul` work on `bigint` and `Decimal128`; `$rename` and `$push.$sort` are typed;
 * array operators work on nested arrays. `undefined` is never a value (the driver would write `null`).
 */

/**
 * `V` without `undefined`.
 *
 * @typeParam V - The value type.
 * @example
 * type A = Defined<string | undefined>; // string
 */
type Defined<V> = Exclude<V, undefined>;

/**
 * The value `$set` takes at write path `P`: the input form, `null` only when the path is nullable.
 *
 * @typeParam T - The document type.
 * @typeParam P - The write path.
 * @example
 * type A = SetValue<{ address: { zip: string } }, "address.zip">; // string
 */
export type SetValue<T, P extends string> = InputOf<Defined<WriteValue<T, P>>>;

/**
 * `$set` (and `$setOnInsert` with `WithImmutable`): write paths → values. The root `_id` is never written.
 *
 * @typeParam T - The document type.
 * @typeParam WithImmutable - `true` to include immutable fields (`$setOnInsert`).
 * @typeParam Loose - `true` for the generic builder constraint (Map entries and `$[id]` paths take anything).
 * @example
 * type A = SetFields<{ _id: string; name: string; age: number }>; // { name?: string; age?: number }
 */
export type SetFields<T, WithImmutable extends boolean = false, Loose extends boolean = false> = {
  [P in Exclude<WritePaths<T, WithImmutable>, "_id">]?: Loose extends true
    ? IsMapEntryKey<P> extends true
      ? unknown
      : P extends `${string}$[${string}]`
        ? unknown /* `revisions.$[${string}]` also matches `revisions.$[r].scores.$[s]`: checked by UpdateCheck */
        : SetValue<T, P>
    : SetValue<T, P>;
};

/**
 * The write paths of `T` whose non-null value type fits `Match`.
 *
 * @typeParam T - The document type.
 * @typeParam Match - The type the value must be assignable to.
 * @example
 * type A = PathsWhere<{ a: number; b: string }, number>; // "a"
 */
type PathsWhere<T, Match> = {
  [P in WritePaths<T>]-?: [NonNullable<WriteValue<T, P>>] extends [never]
    ? never
    : [NonNullable<WriteValue<T, P>>] extends [Match]
      ? P
      : never;
}[WritePaths<T>];

/**
 * Paths that may be removed: optional ones (`?:`). A required field or an array element is never unset.
 *
 * @typeParam T - The document type.
 * @example
 * type A = UnsetPaths<{ name: string; nick?: string }>; // "nick"
 */
export type UnsetPaths<T> = {
  [P in WritePaths<T>]-?: undefined extends WriteValue<T, P> ? P : never;
}[WritePaths<T>];

/**
 * Paths of numbers, `bigint`s (int64) and `Decimal128`s (`$inc`, `$mul`).
 *
 * @typeParam T - The document type.
 * @example
 * type A = NumericPaths<{ age: number; name: string }>; // "age"
 */
export type NumericPaths<T> = PathsWhere<T, number | bigint | Decimal128>;

/**
 * The operand of `$inc`/`$mul` for the value at `P`: of the same numeric kind (an int64 takes a `bigint` or its
 * decimal string, as everywhere else).
 *
 * @typeParam V - The field's value type.
 * @example
 * type A = NumericOperand<number>; // number
 * type B = NumericOperand<bigint>; // bigint | Int64String
 */
export type NumericOperand<V> = V extends number
  ? number
  : V extends bigint
    ? bigint | Int64String
    : V extends Decimal128
      ? Decimal128
      : never;

/**
 * Paths of ordered values (`$min`, `$max`).
 *
 * @typeParam T - The document type.
 * @example
 * type A = OrderablePaths<{ age: number; active: boolean }>; // "age"
 */
export type OrderablePaths<T> = PathsWhere<T, Orderable>;

/**
 * Paths of `Date` or `Timestamp` values (`$currentDate`).
 *
 * @typeParam T - The document type.
 * @example
 * type A = CurrentDatePaths<{ at: Date; n: number }>; // "at"
 */
export type CurrentDatePaths<T> = PathsWhere<T, Date | Timestamp>;

/**
 * Paths of integers (`$bit`): `number` and `bigint`.
 *
 * @typeParam T - The document type.
 * @example
 * type A = IntegerPaths<{ flags: number; name: string }>; // "flags"
 */
export type IntegerPaths<T> = PathsWhere<T, number | bigint>;

/**
 * Paths whose value is an array (`$push`, `$addToSet`, `$pull`, `$pullAll`, `$pop`), at any depth.
 *
 * @typeParam T - The document type.
 * @example
 * type A = ArrayPaths<{ tags: string[]; name: string }>; // "tags"
 */
export type ArrayPaths<T> = PathsWhere<T, readonly unknown[]>;

/**
 * The element type of the array at write path `P`; `never` when it is not an array.
 *
 * @typeParam T - The document type.
 * @typeParam P - The write path.
 * @example
 * type A = ElementAt<{ tags: string[] }, "tags">; // string
 */
type ElementAt<T, P extends string> = NonNullable<WriteValue<T, P>> extends readonly (infer E)[] ? E : never;

/**
 * Removes positional paths (`$`, `$[]`, `$[id]`, numeric segments), which `$rename` refuses.
 *
 * @typeParam P - The candidate path union.
 * @example
 * type A = NoPositional<"a" | "a.$[]" | "a.0">; // "a"
 */
type NoPositional<P> = P extends `${string}$${string}` | `${string}.${number}` | `${number}` ? never : P;

/**
 * `$rename` sources: optional, non-positional paths (after the rename the source is absent).
 *
 * @typeParam T - The document type.
 * @example
 * type A = RenamePaths<{ name: string; nick?: string }>; // "nick"
 */
export type RenamePaths<T> = NoPositional<UnsetPaths<T>>;

/**
 * `$rename` targets of `P`: another non-positional optional path with the same value type.
 *
 * @typeParam T - The document type.
 * @typeParam P - The source path.
 * @example
 * type A = RenameTarget<{ nick?: string; alias?: string; age?: number }, "nick">; // "alias"
 */
export type RenameTarget<T, P extends string> = {
  [Q in RenamePaths<T>]-?: Q extends P
    ? never
    : [Defined<WriteValue<T, Q>>] extends [Defined<WriteValue<T, P>>]
      ? [Defined<WriteValue<T, P>>] extends [Defined<WriteValue<T, Q>>]
        ? Q
        : never
      : never;
}[RenamePaths<T>];

/**
 * `$push.$sort` of an element: `1`/`-1` for scalars, an object of the element's fields for subdocuments.
 *
 * @typeParam E - The array element type.
 * @example
 * type A = PushSort<number>; // 1 | -1
 * type B = PushSort<{ score: number }>; // { readonly score?: 1 | -1 }
 */
export type PushSort<E> = true extends IsPlainObject<E> ? { readonly [K in keyof LeanOf<E>]?: 1 | -1 } : 1 | -1;

/**
 * The operand of `$push`: an element, or `$each` with the modifiers.
 *
 * @typeParam E - The array element type.
 * @example
 * const a: PushOperand<string> = "x";
 * const b: PushOperand<number> = { $each: [3, 1], $sort: 1, $slice: 5 };
 */
export type PushOperand<E> =
  | InputOf<E>
  | {
      readonly $each: readonly InputOf<E>[];
      readonly $position?: number;
      readonly $slice?: number;
      readonly $sort?: PushSort<E>;
    };

/**
 * The operand of `$addToSet`: an element, or `$each`.
 *
 * @typeParam E - The array element type.
 * @example
 * const a: AddToSetOperand<string> = { $each: ["a", "b"] };
 */
export type AddToSetOperand<E> = InputOf<E> | { readonly $each: readonly InputOf<E>[] };

/**
 * The operand of `$pull`: a filter of embedded elements (or `$in`/`$nin`/`$eq`/`$ne` on whole elements,
 * Mongoose gh-6439), a condition of scalar ones.
 *
 * @typeParam E - The array element type.
 * @example
 * const a: PullOperand<{ note: string }> = { note: "old" };
 * const b: PullOperand<string> = { $in: ["a", "b"] };
 */
export type PullOperand<E> =
  true extends IsPlainObject<E> ? Filter<Extract<E, object>> | WholeElement<E> : Condition<E>;

/**
 * Conditions on a whole embedded element (compared as a document).
 *
 * @typeParam E - The array element type.
 * @example
 * const w: WholeElement<{ note: string }> = { $eq: { note: "x" } };
 */
export interface WholeElement<E> {
  /** The element equals one of the documents. */
  readonly $in?: readonly InputOf<E>[];
  /** The element equals none of the documents. */
  readonly $nin?: readonly InputOf<E>[];
  /** The element equals the document. */
  readonly $eq?: InputOf<E>;
  /** The element does not equal the document. */
  readonly $ne?: InputOf<E>;
}

/**
 * The operand of `$bit` for a `number` or `bigint` path.
 *
 * @typeParam V - The field's numeric type.
 * @example
 * const b: BitOperand<number> = { or: 4 };
 */
export type BitOperand<V> = { readonly and: V } | { readonly or: V } | { readonly xor: V };

/**
 * Map-entry keys of the write paths (`counters.${string}`): left `unknown` in the loose form.
 *
 * @typeParam T - The document type.
 * @example
 * type A = MapEntryPaths<{ counters: Map<string, number> }>; // `counters.${string}`
 */
export type MapEntryPaths<T> = { [P in WritePaths<T, true>]-?: IsMapEntryKey<P> extends true ? P : never }[WritePaths<
  T,
  true
>];

/**
 * In the loose form (the builders' generic constraint), every operator also takes Map-entry keys.
 *
 * @typeParam T - The document type.
 * @typeParam Loose - `true` for the loose form.
 * @example
 * type A = LooseEntries<{ counters: Map<string, number> }, true>; // { [`counters.${string}`]?: unknown }
 * type B = LooseEntries<{ n: number }, true>; // unknown
 */
type LooseEntries<T, Loose extends boolean> = Loose extends true
  ? [MapEntryPaths<T>] extends [never]
    ? unknown
    : { [P in MapEntryPaths<T>]?: unknown }
  : unknown;

/**
 * An update document of `T` (operators only; an update pipeline goes through the pipeline builder).
 * `Loose` is the generic constraint of the builders: Map-entry keys take anything and `UpdateCheck`
 * checks the keys actually passed, fields inside Map values included.
 *
 * A type alias, not an interface (see `RootOperators`: an implicit `this` type makes relations structural).
 *
 * @typeParam T - The document type.
 * @typeParam Loose - `true` for the generic builder constraint, `false` for the strict form.
 * @example
 * type User = { name: string; age: number; nick?: string; tags: string[] };
 * const u: Update<User> = { $set: { name: "A" }, $inc: { age: 1 }, $unset: { nick: "" }, $push: { tags: "x" } };
 * // @ts-expect-error $inc applies to numeric paths only
 * const bad: Update<User> = { $inc: { name: 1 } };
 */
export type Update<in out T, in out Loose extends boolean = true> = {
  /** Sets fields to values. */
  $set?: SetFields<T, false, Loose>;
  /** Written only when an upsert inserts; the one place immutable fields may be set. */
  $setOnInsert?: SetFields<T, true, Loose>;
  /** Removes optional fields. */
  $unset?: { [P in UnsetPaths<T>]?: "" | 1 | true } & LooseEntries<T, Loose>;
  /** Adds a number to numeric fields. */
  $inc?: { [P in NumericPaths<T>]?: NumericOperand<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
  /** Multiplies numeric fields. */
  $mul?: { [P in NumericPaths<T>]?: NumericOperand<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
  /** Lowers a field to the value when the value is smaller. */
  $min?: { [P in OrderablePaths<T>]?: CompareOf<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
  /** Raises a field to the value when the value is larger. */
  $max?: { [P in OrderablePaths<T>]?: CompareOf<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
  /** Sets date or timestamp fields to the server time. */
  $currentDate?: {
    [P in CurrentDatePaths<T>]?: NonNullable<WriteValue<T, P>> extends Date
      ? true | { readonly $type: "date" }
      : { readonly $type: "timestamp" };
  } & LooseEntries<T, Loose>;
  /** Renames a field to another optional field of the same type. */
  $rename?: { [P in RenamePaths<T>]?: RenameTarget<T, P> };
  /** Appends elements to arrays. */
  $push?: { [P in ArrayPaths<T>]?: PushOperand<ElementAt<T, P>> } & LooseEntries<T, Loose>;
  /** Appends elements that are not already in the array. */
  $addToSet?: { [P in ArrayPaths<T>]?: AddToSetOperand<ElementAt<T, P>> } & LooseEntries<T, Loose>;
  /** Removes the elements that match a condition. */
  $pull?: { [P in ArrayPaths<T>]?: PullOperand<NonNullable<ElementAt<T, P>>> } & LooseEntries<T, Loose>;
  /** Removes every listed value from arrays. */
  $pullAll?: { [P in ArrayPaths<T>]?: readonly InputOf<ElementAt<T, P>>[] } & LooseEntries<T, Loose>;
  /** Removes the first (`-1`) or last (`1`) element. */
  $pop?: { [P in ArrayPaths<T>]?: 1 | -1 } & LooseEntries<T, Loose>;
  /** Bitwise `and`/`or`/`xor` on integer fields. */
  $bit?: { [P in IntegerPaths<T>]?: BitOperand<NonNullable<WriteValue<T, P>>> } & LooseEntries<T, Loose>;
};

/*
 * arrayFilters and checks of a concrete update
 */

/**
 * The operator keys used by update `U`, over all its operators.
 *
 * @typeParam U - A concrete update document type.
 * @example
 * type A = OperatorKeys<{ $set: { a: 1 }; $inc: { b: 1 } }>; // "a" | "b"
 */
type OperatorKeys<U> = { [O in keyof U]-?: keyof NonNullable<U[O]> & string }[keyof U];

/**
 * The `$[id]` identifiers of an update path with the array path each one addresses.
 *
 * @typeParam K - The update path.
 * @typeParam Done - The already-consumed path prefix.
 * @typeParam D - The remaining recursion depth.
 * @example
 * type A = Identifiers<"revisions.$[r].scores.$[s]">;
 * // { id: "r"; array: "revisions" } | { id: "s"; array: "revisions.$[r].scores" }
 */
type Identifiers<K extends string, Done extends string = "", D extends number = 4> = D extends 0
  ? never
  : K extends `${infer Pre}.$[${infer Id}]${infer Rest}`
    ?
        | (Id extends "" ? never : { readonly id: Id; readonly array: `${Done}${Pre}` })
        | Identifiers<Rest, `${Done}${Pre}.$[${Id}]`, Dec[D]>
    : never;

/**
 * The filter document of one `$[id]` identifier: a condition on the element, plus its fields for
 * subdocument elements (`{ "r.note": ... }`).
 *
 * @typeParam T - The document type.
 * @typeParam I - An identifier record from {@link Identifiers}.
 * @example
 * type A = ArrayFilterDoc<{ tags: string[] }, { id: "t"; array: "tags" }>; // { readonly t?: Condition<string> }
 */
type ArrayFilterDoc<T, I> = I extends { readonly id: infer Id extends string; readonly array: infer A extends string }
  ? ElementAt<T, A> extends infer E
    ? { readonly [K in Id]?: Condition<E> } & (true extends IsPlainObject<NonNullable<E>>
        ? {
            readonly [P in FilterPaths<Extract<NonNullable<E>, object>> as `${Id}.${P}`]?: Condition<
              FilterValue<Extract<NonNullable<E>, object>, P>
            >;
          }
        : unknown)
    : never
  : never;

/**
 * `arrayFilters` of update `U`: one filter per `$[id]` identifier the update uses, typed by the element
 * of the array the identifier addresses (`{ "r.note": … }` for `revisions.$[r].note`). `never` when the
 * update uses no identifier.
 *
 * @typeParam T - The document type.
 * @typeParam U - The concrete update document type.
 * @example
 * // for { $set: { "revisions.$[r].note": "x" } } on { revisions: { note: string }[] }:
 * type A = ArrayFilters<Doc, U>; // readonly ({ readonly r?: ...; readonly "r.note"?: Condition<string> })[]
 */
export type ArrayFilters<T, U> = [Identifiers<OperatorKeys<U>>] extends [never]
  ? never
  : readonly ArrayFilterDoc<T, Identifiers<OperatorKeys<U>>>[];

/**
 * The paths named by two different operators of update `U` (the server refuses that).
 *
 * @typeParam U - The concrete update document type.
 * @example
 * type A = ConflictingKeys<{ $set: { a: 1 }; $inc: { a: 1 } }>; // "a"
 */
type ConflictingKeys<U> = {
  [O in keyof U]-?: keyof NonNullable<U[O]> &
    { [Q in Exclude<keyof U, O>]-?: keyof NonNullable<U[Q]> }[Exclude<keyof U, O>];
}[keyof U];

/**
 * The operators of `U` that have no paths.
 *
 * @typeParam U - The concrete update document type.
 * @example
 * type A = EmptyOperators<{ $set: {}; $inc: { a: 1 } }>; // "$set"
 */
type EmptyOperators<U> = { [O in keyof U]-?: [keyof NonNullable<U[O]>] extends [never] ? O : never }[keyof U];

/**
 * The element type of an array value; `never` for a non-array.
 *
 * @typeParam W - The value type.
 * @example
 * type A = ElementOfValue<string[] | undefined>; // string
 */
type ElementOfValue<W> = NonNullable<W> extends readonly (infer E)[] ? E : never;

/**
 * The operand operator `O` takes for a value of type `W` (`never`: the operator does not apply).
 *
 * @typeParam O - The operator name.
 * @typeParam W - The field's value type.
 * @example
 * type A = OperandFor<"$inc", number>; // number
 * type B = OperandFor<"$inc", string>; // never
 */
type OperandFor<O, W> = O extends "$set" | "$setOnInsert"
  ? InputOf<Defined<W>>
  : O extends "$unset"
    ? "" | 1 | true
    : O extends "$inc" | "$mul"
      ? NumericOperand<NonNullable<W>>
      : O extends "$min" | "$max"
        ? [NonNullable<W>] extends [Orderable]
          ? CompareOf<NonNullable<W>>
          : never
        : O extends "$currentDate"
          ? [NonNullable<W>] extends [Date]
            ? true | { readonly $type: "date" }
            : [NonNullable<W>] extends [Timestamp]
              ? { readonly $type: "timestamp" }
              : never
          : O extends "$push"
            ? [ElementOfValue<W>] extends [never]
              ? never
              : PushOperand<ElementOfValue<W>>
            : O extends "$addToSet"
              ? [ElementOfValue<W>] extends [never]
                ? never
                : AddToSetOperand<ElementOfValue<W>>
              : O extends "$pull"
                ? [ElementOfValue<W>] extends [never]
                  ? never
                  : PullOperand<NonNullable<ElementOfValue<W>>>
                : O extends "$pullAll"
                  ? [ElementOfValue<W>] extends [never]
                    ? never
                    : readonly InputOf<ElementOfValue<W>>[]
                  : O extends "$pop"
                    ? [ElementOfValue<W>] extends [never]
                      ? never
                      : 1 | -1
                    : O extends "$bit"
                      ? [NonNullable<W>] extends [number | bigint]
                        ? BitOperand<NonNullable<W>>
                        : never
                      : never;

/**
 * The problem message of one loose key (a Map entry or a `$[id]` path) with value `V`, or `never` when it fits.
 *
 * @typeParam T - The document type.
 * @typeParam O - The operator name.
 * @typeParam K - The path.
 * @typeParam V - The value passed.
 * @example
 * type A = LooseKeyProblem<{ n: number }, "$inc", "x", 1>; // `"$inc.x": unknown path`
 */
type LooseKeyProblem<T, O extends string, K extends string, V> = [WriteValue<T, K>] extends [never]
  ? `"${O}.${K}": unknown path`
  : [OperandFor<O, WriteValue<T, K>>] extends [never]
    ? `"${O}" does not apply to "${K}"`
    : V extends OperandFor<O, WriteValue<T, K>>
      ? never
      : `"${O}.${K}": the value does not fit the field's type`;

/**
 * The problem messages of the paths of one operator `O` with operands `Ops`.
 *
 * @typeParam T - The document type.
 * @typeParam O - The operator name.
 * @typeParam Ops - The operator's operand record.
 * @example
 * type A = OperatorProblems<{ n: number }, "$set", { z: 1 }>; // `"$set.z": unknown path`
 */
type OperatorProblems<T, O extends string, Ops> = {
  /* `Required`: an optional key (`patch: UpdateInput<T>`) may be absent, which is not an `undefined` value; with
     `exactOptionalPropertyTypes` an explicit `?: X | undefined` still keeps its `undefined` and is refused */
  [K in keyof Ops & string]-?: undefined extends Required<Ops>[K]
    ? `"${O}.${K}" is undefined (undefined is never a value; use $unset)`
    : O extends keyof Update<T, true>
      ? K extends keyof NonNullable<Update<T, true>[O]>
        ? K extends MapEntryPaths<T> | `${string}$[${string}]`
          ? LooseKeyProblem<T, O, K, Ops[K]>
          : never
        : `"${O}.${K}": unknown path`
      : never;
}[keyof Ops & string];

/**
 * Every problem of update `U` of `T` (a union of messages, `never` when there are none).
 *
 * @typeParam T - The document type.
 * @typeParam U - The concrete update document type.
 * @example
 * type A = UpdateProblems<{ n: number }, {}>; // a message: "an empty update changes nothing ..."
 */
export type UpdateProblems<T, U> =
  | ([keyof U] extends [never] ? "an empty update changes nothing" : never)
  | ([EmptyOperators<U>] extends [never] ? never : `operator "${EmptyOperators<U> & string}" is empty`)
  | ([ConflictingKeys<U>] extends [never]
      ? never
      : `"${ConflictingKeys<U> & string}" is changed by two operators (server code 40)`)
  | { [O in keyof U & string]-?: OperatorProblems<T, O, NonNullable<U[O]>> }[keyof U & string];

/**
 * `unknown` when update `U` of `T` is acceptable, otherwise a required property with the problems: an
 * empty update (an error, not a silent no-op — Mongoose sent nothing and returned
 * `acknowledged: false`, M5 #3), an empty operator, one path under two operators (server code 40
 * ConflictingUpdateOperators), `undefined` values, keys inside Map values that do not exist or do
 * not fit, keys no operator knows (a generic argument has no excess-property check).
 *
 * @typeParam T - The document type.
 * @typeParam U - The concrete update document type.
 * @example
 * type A = UpdateCheck<{ n: number }, { $set: { n: 1 } }>; // unknown (acceptable)
 * type B = UpdateCheck<{ n: number }, {}>; // { readonly "update error": ... }
 */
export type UpdateCheck<T, U> =
  IsWide<U> extends true
    ? unknown /* a declared `Update<T>` value, not a literal: the constraint checked it */
    : [UpdateProblems<T, U>] extends [never]
      ? unknown
      : { readonly "update error": UpdateProblems<T, U> };

/**
 * Options of `updateOne`/`updateMany`.
 *
 * @typeParam T - The document type.
 * @typeParam U - The concrete update document type.
 * @example
 * const o: UpdateOptions<Doc, U> = { upsert: true };
 */
export interface UpdateOptions<T, U> {
  /** Insert a document when nothing matches. */
  readonly upsert?: boolean;
  /** Filters for the `$[id]` identifiers the update uses. */
  readonly arrayFilters?: ArrayFilters<T, U>;
}

/**
 * Options of `findOneAndUpdate`.
 *
 * @typeParam T - The document type.
 * @typeParam U - The concrete update document type.
 * @example
 * const o: FindOneAndUpdateOptions<Doc, U> = { returnDocument: "before" };
 */
export interface FindOneAndUpdateOptions<T, U> extends UpdateOptions<T, U> {
  /** Which version of the document to return; `"after"` by default. */
  readonly returnDocument?: "before" | "after";
}
