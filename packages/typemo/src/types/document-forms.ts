import type { Decimal128, ObjectId, UUID } from "mongodb";
import type { Int64String, IsVector, JsonValue, LeanValue, PlainValue } from "../bson/bson-type-table.ts";
import type { OpaqueValue } from "../bson/opaque-value.ts";
import type { HYDRATED_ENTITY, HydratedDoc } from "../document/document-types.ts";
import type { IsDefaulted, IsHidden, IsTenantField, RefMarker, Unbranded } from "./markers.ts";
import type { WritableKeys } from "./paths.ts";
import type { AnyPopulatedField, IsTransformed, PopulatedOriginalOf, PopulatedValueOf } from "./populate.ts";
import type { DataKeys } from "./schema-paths.ts";
import type { Simplify } from "./type-utils.ts";

/*
 * The forms of a document. What is data and what is not is decided ONLY by the explicit markers
 * (`Computed`, `VirtualValue`, `VirtualRef` are virtuals; methods are functions), never by `readonly`.
 * Scalars go through the ONE BSON type table (`LeanValue` / `JsonValue` / `PlainValue` of
 * `bson-type-table.ts`). The whole table: from-mongoose-to-typemo/guides/value-forms.md.
 *
 * | form             | what                                                            |
 * |------------------|-----------------------------------------------------------------|
 * | `Output<T>`      | a hydrated document: `HydratedDoc<T>` — typed collections + `$`-methods |
 * | `Lean<T>`        | what the driver returns (`lean()`): data only, markers removed, `Map` → record |
 * | `ObjectForm<T>`  | `$toObject()`: the data of `Lean<T>`, `Map` fields as `Map` |
 * | `Plain<T>`       | `$toPlain()` / `.plain()`: the plain row of every BSON value (`PlainValue`) |
 * | `PlainJson<T>`   | `$toJSON()`: the JSON row of every BSON value (`JsonValue`)   |
 * | `CreateInput<T>` | input of create/insert: `Defaulted`, array and `?` fields optional, virtuals absent |
 * | `UpdateInput<T>` | fields a write may set: no immutable, no `_id`, all optional     |
 *
 * `Ref<M>` stays in the lean/plain forms (an id with a meaning): populate replaces exactly those
 * fields, and the lean shape is computed BEFORE populate ("lean first").
 *
 * Every form is a mapped type over `keyof T` written as `{ …mapped… } & {}` (`CreateInput` and `Replacement`:
 * `Simplify` of their two halves). The intersection with `{}` reduces to the mapped type itself, and a mapped type
 * over `keyof T` instantiated for a class carries no alias, so the IDE prints the fields
 * (`{ name: string; _id: string }`) instead of the alias name (`Plain<User, false>`); a generic `T` still gives a
 * plain mapped type to the code around it. A mapped type over another key set (`[K in Exclude<…>]`) would keep
 * the alias name.
 */

/**
 * `V` without `undefined`.
 *
 * @typeParam V - The value type.
 * @example
 * type A = NoUndefined<string | undefined>; // string
 */
type NoUndefined<V> = V extends undefined ? never : V;

/**
 * The entity behind a hydrated document (a populated value), the value itself otherwise. The forms of a populated
 * document are computed from its entity type: the fields of a hydrated document carry no markers (the IDE shows
 * `string`, not `string & HiddenMarker`), so a `Hidden` field is known only from the entity.
 *
 * @typeParam V - The value type.
 * @example
 * type A = EntityOf<HydratedDoc<User>>; // User
 * type B = EntityOf<{ a: 1 }>; // { a: 1 }
 */
type EntityOf<V> = V extends { readonly [HYDRATED_ENTITY]?: readonly [infer U] } ? U : V;

/**
 * The stored data of `T`: its data keys with their declared types (markers kept).
 *
 * @typeParam T - The entity type.
 * @example
 * type A = DataFields<{ name: string; full: Computed<string>; save(): void }>; // { name: string }
 */
export type DataFields<T> = { [K in keyof T as K extends DataKeys<T> ? K : never]: T[K] };

/**
 * The type of `T`'s `_id` without markers (`ObjectId` for `extends Entity`), `never` when `T` has none.
 *
 * @typeParam T - The entity type.
 * @example
 * type A = IdOf<{ _id: ObjectId; name: string }>; // ObjectId
 * type B = IdOf<{ name: string }>; // never
 */
export type IdOf<T> = "_id" extends keyof T ? Unbranded<NonNullable<T["_id" & keyof T]>> : never;

/**
 * A hydrated document of `T`: the entity instance with the typed collections for its data fields and the
 * `$`-methods (`HydratedDoc`).
 *
 * @typeParam T - The entity type.
 * @example
 * type A = Output<User>; // HydratedDoc<User>
 */
export type Output<T> = HydratedDoc<T>;

/*
 * lean / plain
 */

/**
 * The lean form of one value: markers removed, a `Map` as a record, BSON scalars as their lean row.
 *
 * @typeParam V - The value type.
 * @example
 * type A = LeanOf<Map<string, number>>; // { [key: string]: number }
 * type B = LeanOf<ObjectId[]>; // ObjectId[]
 */
export type LeanOf<V> = V extends null | undefined
  ? V
  : V extends RefMarker<unknown>
    ? Unbranded<V>
    : V extends string | number | boolean | bigint
      ? Unbranded<V>
      : V extends ReadonlyMap<string, infer M>
        ? { [key: string]: LeanOf<M> }
        : V extends OpaqueValue
          ? LeanValue<Unbranded<V>>
          : V extends readonly (infer E)[]
            ? LeanOf<E>[]
            : V extends object
              ? Lean<V>
              : never;

/**
 * The lean form of a document or subdocument: data keys only, optional fields stay optional
 * (homomorphic mapping), `-readonly`, markers removed, BSON scalars as the table's lean row.
 *
 * @typeParam T - The entity or subdocument type.
 * @example
 * type A = Lean<{ readonly _id: ObjectId; nick?: string; full: Computed<string> }>;
 * // { _id: ObjectId; nick?: string }
 */
export type Lean<T> = {
  -readonly [K in keyof T as K extends DataKeys<T> ? K : never]: LeanOf<NoUndefined<T[K]>>;
} & {};

/**
 * The serialized forms of a document: `$toObject()`, `$toJSON()`, `$toPlain()`.
 *
 * @example
 * const f: SerializedForm = "json";
 */
type SerializedForm = "object" | "json" | "plain";

/**
 * The data keys a serialized form keeps: with `H` (the `hidden` option) `false`, the `Hidden` fields
 * are left out — at EVERY depth, as the runtime does (subdocuments, arrays and Maps of them, populated documents).
 *
 * @typeParam T - The entity type.
 * @typeParam K - The candidate key.
 * @typeParam H - Whether `Hidden` fields are kept.
 * @example
 * type A = FormKey<{ name: string; pass: Hidden<string> }, "pass", false>; // never
 * type B = FormKey<{ name: string; pass: Hidden<string> }, "pass", true>; // "pass"
 */
type FormKey<T, K, H extends boolean> =
  K extends DataKeys<T> ? (H extends true ? K : IsHidden<T[K]> extends true ? never : K) : never;

/**
 * A populated field in a serialized form: the documents in that form; transform results as they are.
 *
 * @typeParam V - The populated field type.
 * @typeParam Form - The serialized form.
 * @typeParam H - Whether `Hidden` fields are kept.
 * @example
 * type A = PopulatedPlain<Populated<User, ...>, "plain", true>; // the plain form of User
 */
type PopulatedPlain<V, Form extends SerializedForm, H extends boolean> =
  IsTransformed<V> extends true
    ? PopulatedValueOf<V> extends readonly (infer E)[]
      ? E[]
      : PopulatedValueOf<V> extends ReadonlyMap<string, infer M>
        ? Form extends "json"
          ? { [key: string]: M }
          : Map<string, M>
        : PopulatedValueOf<V>
    : Form extends "json"
      ? JsonOf<PopulatedValueOf<V>, H>
      : Form extends "plain"
        ? PlainOf<PopulatedValueOf<V>, H>
        : ObjectFormOf<PopulatedValueOf<V>, H>;

/**
 * The `$toObject()` form of one value: as {@link LeanOf}, except
 * that a `Map` field stays a `Map` (its values in this form) — the runtime of `$toObject()` gives exactly this.
 *
 * @typeParam V - The value type.
 * @typeParam H - Whether `Hidden` fields are kept, at every depth (`$toObject()` keeps them by default).
 * @example
 * type A = ObjectFormOf<Map<string, number>>; // Map<string, number>
 */
export type ObjectFormOf<V, H extends boolean = true> = V extends null | undefined
  ? V
  : V extends AnyPopulatedField
    ? PopulatedPlain<V, "object", H>
    : V extends RefMarker<unknown>
      ? Unbranded<V>
      : V extends string | number | boolean | bigint
        ? Unbranded<V>
        : V extends ReadonlyMap<string, infer M>
          ? Map<string, ObjectFormOf<M, H>>
          : V extends OpaqueValue
            ? LeanValue<Unbranded<V>>
            : V extends readonly (infer E)[]
              ? ObjectFormOf<E, H>[]
              : V extends object
                ? ObjectForm<EntityOf<V>, H>
                : never;

/**
 * `$toObject()`: the data of {@link Lean}, but `Map` fields stay `Map`s
 * (`Map` in `toObject`, record in JSON); BSON values as they are.
 *
 * @typeParam T - The entity or subdocument type.
 * @typeParam H - Whether `Hidden` fields are kept, as in {@link ObjectFormOf}.
 * @example
 * type A = ObjectForm<{ _id: ObjectId; visits: Map<string, number> }>; // { _id: ObjectId; visits: Map<string, number> }
 */
export type ObjectForm<T, H extends boolean = true> = {
  -readonly [K in keyof T as FormKey<T, K, H>]: ObjectFormOf<NoUndefined<T[K]>, H>;
} & {};

/**
 * The plain form of one value (`$toPlain()`, `.plain()`): every BSON scalar as its `PlainValue` row
 * (`ObjectId`, `bigint`, `Decimal128`, `UUID` → `string`; `Date`, `RegExp` kept; `Binary` → `Uint8Array`; a
 * vector → `number[]`), a `Map` as a `Map` of plain values, a populated field as plain documents.
 *
 * @typeParam V - The value type.
 * @typeParam H - Whether `Hidden` fields are kept, at every depth (`$toPlain()` leaves them out unless
 * `{ hidden: true }`).
 * @example
 * type A = PlainOf<ObjectId>; // string
 * type B = PlainOf<Date[]>; // Date[]
 */
export type PlainOf<V, H extends boolean = true> = V extends null | undefined
  ? V
  : V extends AnyPopulatedField
    ? PopulatedPlain<V, "plain", H>
    : V extends ReadonlyMap<string, infer M>
      ? Map<string, PlainOf<M, H>>
      : V extends string | number | boolean | bigint | OpaqueValue
        ? PlainValue<Unbranded<V>>
        : V extends readonly (infer E)[]
          ? PlainOf<E, H>[]
          : V extends object
            ? Plain<EntityOf<V>, H>
            : never;

/**
 * The plain form of a document (what `$toPlain()` and `.plain()` return, before their options): data
 * keys, plain rows of the values. `JSON.stringify` prints it without losing anything but the native types' own
 * JSON (`Date` → ISO string, `Map` → `{}`: use `$toJSON()` for JSON).
 *
 * @typeParam T - The entity or subdocument type.
 * @typeParam H - Whether `Hidden` fields are kept, as in {@link PlainOf}.
 * @example
 * type A = Plain<{ _id: ObjectId; at: Date; big: bigint }>; // { _id: string; at: Date; big: string }
 */
export type Plain<T, H extends boolean = true> = {
  -readonly [K in keyof T as FormKey<T, K, H>]: PlainOf<NoUndefined<T[K]>, H>;
} & {};

/**
 * The JSON form of one value (`toJSON()`): every BSON scalar as its `JsonValue` row.
 *
 * @typeParam V - The value type.
 * @typeParam H - Whether `Hidden` fields are kept, as in {@link PlainOf}.
 * @example
 * type A = JsonOf<Date>; // string
 * type B = JsonOf<Map<string, ObjectId>>; // { [key: string]: string }
 */
export type JsonOf<V, H extends boolean = true> = V extends null | undefined
  ? V
  : V extends AnyPopulatedField
    ? PopulatedPlain<V, "json", H>
    : /* a Map before the scalars: `OpaqueValue` includes `ReadonlyMap`, and its values need this schema walk
         (`Hidden` fields, references), not the table's schemaless record row */
      V extends ReadonlyMap<string, infer M>
      ? { [key: string]: JsonOf<M, H> }
      : V extends string | number | boolean | bigint | OpaqueValue
        ? JsonValue<Unbranded<V>>
        : V extends readonly (infer E)[]
          ? JsonOf<E, H>[]
          : V extends object
            ? PlainJson<EntityOf<V>, H>
            : never;

/**
 * `toJSON()` of a document: data keys, JSON rows of the values.
 *
 * @typeParam T - The entity or subdocument type.
 * @typeParam H - Whether `Hidden` fields are kept, as in {@link PlainOf}.
 * @example
 * type A = PlainJson<{ _id: ObjectId; at: Date }>; // { _id: string; at: string }
 */
export type PlainJson<T, H extends boolean = true> = {
  -readonly [K in keyof T as FormKey<T, K, H>]: JsonOf<NoUndefined<T[K]>, H>;
} & {};

/*
 * input
 */

/**
 * What `$set` takes for a populated field: its stored ids, or for a single reference the referenced document
 * (its `_id` is stored); a virtual takes nothing. Not written through `InputOf` itself: a recursive `InputOf` of
 * the box made deferred comparisons infinite (TS2589).
 *
 * @typeParam O - The original (unpopulated) field type.
 * @example
 * type A = PopulatedInput<Ref<User>[]>; // readonly ObjectId[]
 * type B = PopulatedInput<Ref<User>>; // ObjectId | RefDocumentInput<ObjectId>
 */
type PopulatedInput<O> =
  O extends RefMarker<unknown>
    ? Unbranded<O> | RefDocumentInput<Unbranded<O>>
    : O extends readonly (infer E)[]
      ? readonly Unbranded<NonNullable<E>>[]
      : O extends ReadonlyMap<string, infer M>
        ? ReadonlyMap<string, Unbranded<NonNullable<M>>> | { readonly [key: string]: Unbranded<NonNullable<M>> }
        : never;

/** The decimal string of an int64: defined with the BSON type table, re-exported here. */
export type { Int64String } from "../bson/bson-type-table.ts";

/**
 * The string an input also takes for a stored value: the value's plain form, accepted back wherever the value is
 * (create, updates, filters, `findById`, `SubdocumentArray#id`). An int64 takes its decimal string, an `ObjectId`
 * its 24-character hex string, a `UUID` its canonical string, a `Decimal128` its decimal string (`"1.10"`); the
 * core checks the string's format at run time (`CastError`). Other values take no string: a `number` `_id` is a
 * number, a `string` `_id` is already a string.
 *
 * @typeParam V - The value type.
 * @example
 * type A = StringInputOf<bigint>; // Int64String
 * type B = StringInputOf<ObjectId>; // string
 * type C = StringInputOf<Decimal128>; // string
 * type D = StringInputOf<number>; // never
 */
export type StringInputOf<V> = V extends bigint ? Int64String : V extends ObjectId | UUID | Decimal128 ? string : never;

/**
 * The plain form a vector input also takes: its numbers (`number[]`), as `$toPlain()` gives them back.
 *
 * @typeParam V - The value type.
 * @example
 * type A = VectorInputOf<Vector>; // readonly number[]
 * type B = VectorInputOf<Binary>; // never
 */
type VectorInputOf<V> = IsVector<V> extends true ? readonly number[] : never;

/**
 * A document given for a reference: anything with the referenced `_id` — a hydrated document, its lean or plain
 * form, an instance of its class. The core stores only its `_id`.
 *
 * @typeParam Id - The type of the referenced `_id`.
 * @example
 * type A = RefDocumentInput<ObjectId>; // { readonly _id: ObjectId }
 */
export interface RefDocumentInput<Id> {
  /** The referenced document's id: the only part that is stored. */
  readonly _id: Id;
}

/**
 * The id `findById` and its siblings take: the `_id` type of the entity and its string form ({@link StringInputOf}).
 *
 * @typeParam T - The entity type.
 * @example
 * type A = IdInputOf<{ _id: ObjectId }>; // ObjectId | string
 * type B = IdInputOf<{ _id: number }>; // number
 */
export type IdInputOf<T> = IdOf<T> | StringInputOf<IdOf<T>>;

/**
 * The input form of one value: a `Ref<M>` takes its id, its string form or the referenced document
 * ({@link RefDocumentInput}), a `Map` field also takes a plain object, an int64, an `ObjectId`, a `UUID` and a
 * `Decimal128` also take their string ({@link StringInputOf}), a `Vector` its `number[]`, arrays may be readonly,
 * subdocuments are {@link CreateInput}.
 *
 * @typeParam V - The value type.
 * @example
 * type A = InputOf<bigint>; // bigint | Int64String
 * type B = InputOf<Map<string, number>>; // ReadonlyMap<string, number> | { readonly [key: string]: number }
 * type C = InputOf<Ref<User>>; // ObjectId | string | RefDocumentInput<ObjectId>
 */
export type InputOf<V> = V extends null
  ? null
  : V extends AnyPopulatedField
    ? PopulatedInput<PopulatedOriginalOf<V>>
    : V extends RefMarker<unknown>
      ? Unbranded<V> | StringInputOf<Unbranded<V>> | RefDocumentInput<Unbranded<V>>
      : V extends bigint
        ? Unbranded<V> | Int64String
        : V extends string | number | boolean
          ? Unbranded<V>
          : V extends ReadonlyMap<string, infer M>
            ? ReadonlyMap<string, InputOf<NoUndefined<M>>> | { readonly [key: string]: InputOf<NoUndefined<M>> }
            : V extends OpaqueValue
              ? Unbranded<V> | StringInputOf<Unbranded<V>> | VectorInputOf<V>
              : V extends readonly (infer E)[]
                ? readonly InputOf<NoUndefined<E>>[]
                : V extends object
                  ? CreateInput<V>
                  : never;

/**
 * `true` when the core fills the field on create: `Defaulted`, the tenant field (`TenantField`), or an array (an
 * array field without `required` and `default` starts as `[]`; the run time still refuses a missing array that is
 * `required: true`, which the class type cannot show).
 *
 * @typeParam F - The field type.
 * @example
 * type A = CoreFilled<Defaulted<string>>; // true
 * type B = CoreFilled<string[]>; // true
 */
type CoreFilled<F> =
  IsDefaulted<F> extends true
    ? true
    : IsTenantField<F> extends true
      ? true
      : NonNullable<F> extends readonly unknown[]
        ? true
        : false;

/**
 * The data keys of `T` that are optional (`Optional` = `true`) or required (`false`) on create.
 *
 * @typeParam T - The entity type.
 * @typeParam Optional - Which group of keys to pick.
 * @example
 * type A = InputKeys<{ a: string; b: Defaulted<number> }, true>; // "b"
 */
type InputKeys<T, Optional extends boolean> = {
  [K in keyof T]-?: K extends DataKeys<T> ? (CoreFilled<T[K]> extends Optional ? K : never) : never;
}[keyof T];

/**
 * What creating a document takes: data fields; `Defaulted` ones, arrays, the `TenantField` and `?` ones optional; virtuals
 * absent; `undefined` is never a value (absent is written as absent).
 *
 * @typeParam T - The entity type.
 * @example
 * type A = CreateInput<{ name: string; role: Defaulted<string>; nick?: string }>;
 * // { name: string; role?: string; nick?: string }
 */
export type CreateInput<T> = InputFields<T, never>;

/**
 * The create input of `T` without the keys `Omitted` ({@link CreateInput}, {@link Replacement}). Mapped over `T`
 * itself and flattened, so the IDE prints the fields.
 *
 * @typeParam T - The entity type.
 * @typeParam Omitted - The keys left out.
 * @example
 * type A = InputFields<{ _id: ObjectId; name: string }, "_id">; // { name: string }
 */
type InputFields<T, Omitted> = Simplify<
  {
    -readonly [K in keyof T as K extends Exclude<InputKeys<T, false>, Omitted> ? K : never]: InputOf<NoUndefined<T[K]>>;
  } & {
    -readonly [K in keyof T as K extends Exclude<InputKeys<T, true>, Omitted> ? K : never]?: InputOf<NoUndefined<T[K]>>;
  }
>;

/**
 * What a write may set: writable data fields (no immutable, no `_id`), every one optional.
 *
 * @typeParam T - The entity type.
 * @example
 * type A = UpdateInput<{ _id: ObjectId; name: string; created: Immutable<Date> }>; // { name?: string }
 */
export type UpdateInput<T> = {
  -readonly [K in keyof T as K extends Exclude<WritableKeys<T>, "_id"> ? K : never]?: InputOf<NoUndefined<T[K]>>;
} & {};

/**
 * The service fields the core maintains (`Timestamped`, `Versioned`): never part of a replacement.
 *
 * @example
 * const k: ServiceKeys = "updatedAt";
 */
export type ServiceKeys = "createdAt" | "updatedAt" | "__v";

/**
 * The replacement document of `replaceOne`/`findOneAndReplace`: a full create input without `_id` and
 * without the service fields (the core keeps `createdAt`/`__v` and bumps `updatedAt`).
 *
 * @typeParam T - The entity type.
 * @example
 * type A = Replacement<{ _id: ObjectId; name: string; createdAt: Date }>; // { name: string }
 */
export type Replacement<T> = InputFields<T, "_id" | ServiceKeys>;
