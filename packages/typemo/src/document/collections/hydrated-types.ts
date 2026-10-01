import type { AnyFunction, OpaqueValue } from "../../bson/opaque-value.ts";
import type { CreateInput, IdInputOf, InputOf, Plain, PlainOf } from "../../types/document-forms.ts";
import type { Unbranded } from "../../types/markers.ts";
import type { AnyPopulatedField, PopulatedOriginalOf, PopulatedValueOf } from "../../types/populate.ts";
import type { DataKeys } from "../../types/schema-paths.ts";
import type { DocumentPaths, HydratedDoc } from "../document-types.ts";
import type { StrictArray } from "./strict-array.ts";
import type { SubdocumentArray } from "./subdocument-array.ts";
import type { PlainFormOptions } from "./tracked-protocol.ts";
import type { TypedMap } from "./typed-map.ts";

/*
 * The type-level side of the typed collections: what a FIELD of a hydrated document is. It maps the declared
 * field type (`tags!: string[]`), never the runtime spec: the spec is not visible in the document type.
 * Lean / `toObject` / `toJSON` stay plain (`Lean<T>` & co. of `types/document-forms.ts`).
 *
 * | declared field type            | hydrated field                         |
 * |--------------------------------|----------------------------------------|
 * | `X[]` (X scalar/BSON/array/Map)| `StrictArray<HydratedField<X>>`        |
 * | `C[]` (C a class)              | `SubdocumentArray<C>`                  |
 * | `Map<string, X>`               | `TypedMap<HydratedField<X>>`           |
 * | `C` (subdocument or nested)    | `Subdocument<C>`                       |
 * | scalars, BSON values, `Ref<M>` | the value, markers removed (`Ref` kept) |
 * | `null` / `undefined` members   | kept                                   |
 *
 * Markers on containers (`Defaulted<string[]>`) are dropped: the container type says everything.
 */

/** Phantom key (type only, never present at run time) carrying the entity class of a subdocument. */
declare const ENTITY: unique symbol;
/**
 * Phantom key (type only, never present at run time) naming the element of a `StrictArray`:
 * `ElementInput` recognizes a container by it instead of matching the whole interface (a structural match
 * walked `$toPlain` and grew too complex, TS2590).
 */
export declare const STRICT_ELEMENT: unique symbol;
/** Phantom key (type only, never present at run time) naming the element class of a `SubdocumentArray`. */
export declare const SUBDOCUMENT_ELEMENT: unique symbol;

/**
 * Values a path never walks into (scalars, BSON values, functions).
 *
 * @example
 * ```ts
 * type Ok = string extends Leaf ? true : false; // true
 * ```
 */
type Leaf = OpaqueValue | string | number | boolean | bigint | symbol | AnyFunction;

/**
 * `true` for a class instance type that is embedded as a (sub)document.
 *
 * @example
 * ```ts
 * type A = IsEmbedded<Address>; // true
 * type B = IsEmbedded<string>; // false
 * ```
 */
export type IsEmbedded<E> = [E] extends [Leaf | readonly unknown[] | ReadonlyMap<string, unknown> | null | undefined]
  ? false
  : [E] extends [object]
    ? true
    : false;

/**
 * The embedded class of an element without `null`/`undefined` and markers (distributive: hover shows `A | B`).
 *
 * @example
 * ```ts
 * type C = EmbeddedClass<Address | null>; // Address
 * ```
 */
export type EmbeddedClass<E> = E extends null | undefined ? never : Unbranded<E>;

/**
 * The hydrated array of elements `E`: a `SubdocumentArray` of classes, a `StrictArray` otherwise.
 *
 * @example
 * ```ts
 * type A = ArrayField<Address>; // SubdocumentArray<Address>
 * type B = ArrayField<string>; // StrictArray<string>
 * ```
 */
type ArrayField<E> =
  IsEmbedded<EmbeddedClass<E>> extends true ? SubdocumentArray<EmbeddedClass<E>> : StrictArray<HydratedField<E>>;

/**
 * The hydrated form of a field of declared type `V` (see the table above).
 *
 * @example
 * ```ts
 * type T = HydratedField<string[]>; // StrictArray<string>
 * type M = HydratedField<Map<string, number>>; // TypedMap<number>
 * ```
 */
export type HydratedField<V> = V extends null | undefined
  ? V
  : V extends AnyPopulatedField
    ? PopulatedValueOf<V>
    : V extends ReadonlyMap<string, infer M>
      ? TypedMap<HydratedField<M>>
      : /* A leaf without its markers: the IDE shows `string`, not `string & HiddenMarker`; a union of discriminators
           narrows by a plain literal (not by a branded one, which is no unit type); every `T` is still assignable
           to `T & Marker`, so a hydrated document stays assignable to its class. */
        V extends Leaf
        ? Unbranded<V>
        : V extends readonly (infer E)[]
          ? ArrayField<E>
          : V extends object
            ? Subdocument<Unbranded<V>>
            : V;

/**
 * The fields of a hydrated (sub)document of `T`: data fields through {@link HydratedField}; methods,
 * getters and virtuals as declared. Homomorphic, so `?` and `readonly` are kept.
 *
 * @example
 * ```ts
 * class User { name!: string; tags!: string[]; }
 * type H = HydratedFields<User>; // { name: string; tags: StrictArray<string> }
 * ```
 */
export type HydratedFields<T> = { [K in keyof T]: K extends DataKeys<T> ? HydratedField<T[K]> : T[K] };

/**
 * `V` without its `undefined` member.
 *
 * @example
 * ```ts
 * type A = NoUndefined<string | undefined>; // string
 * ```
 */
type NoUndefined<V> = V extends undefined ? never : V;

/**
 * The plain (untracked) form of a value: arrays, native `Map`s, plain objects of data fields.
 *
 * @example
 * ```ts
 * type P = ObjectData<Map<string, Date>>; // Map<string, Date>
 * ```
 */
export type ObjectData<V> = V extends null | undefined
  ? V
  : V extends AnyPopulatedField
    ? ObjectData<PopulatedOriginalOf<V>>
    : V extends ReadonlyMap<string, infer M>
      ? Map<string, ObjectData<M>>
      : V extends Leaf
        ? Unbranded<V>
        : V extends readonly (infer E)[]
          ? ObjectData<E>[]
          : V extends { readonly [ENTITY]: infer S }
            ? ObjectDoc<S>
            : V extends object
              ? ObjectDoc<V>
              : never;

/**
 * The plain form of a value of a tracked collection, from its HYDRATED type `V` (the element of a
 * `StrictArray`, the value of a `TypedMap`): containers are mapped back through their own element (built-in
 * `ReadonlyArray`/`ReadonlyMap`: matching the collection interfaces would walk their `$toPlain` again), a
 * subdocument through its entity class; anything else is a declared value (`PlainOf`). `PlainOf` over a
 * hydrated type would walk the whole `Subdocument` intersection (TS2590). `H`: with `Hidden` fields.
 *
 * @example
 * ```ts
 * type P = PlainFormOf<StrictArray<string>, false>; // string[]
 * ```
 */
export type PlainFormOf<V, H extends boolean> = V extends null | undefined
  ? V
  : V extends { readonly [ENTITY]: infer S }
    ? Plain<S, H>
    : V extends ReadonlyMap<string, infer M>
      ? Map<string, PlainFormOf<M, H>>
      : V extends readonly (infer E)[]
        ? PlainFormOf<E, H>[]
        : PlainOf<V, H>;

/**
 * The plain data of a (sub)document: data keys only, `-readonly`, markers removed, containers plain.
 *
 * @example
 * ```ts
 * class Address { city!: string; tags!: string[]; }
 * type D = ObjectDoc<Address>; // { city: string; tags: string[] }
 * ```
 */
export type ObjectDoc<T> = {
  -readonly [K in keyof T as K extends DataKeys<T> ? K : never]: ObjectData<NoUndefined<T[K]>>;
};

/**
 * What a subdocument field or element accepts: a subdocument, an instance of its class, or create input.
 *
 * @example
 * ```ts
 * const input: SubdocumentInput<Address> = { city: "Oslo" };
 * ```
 */
export type SubdocumentInput<T> = Subdocument<T> | T | CreateInput<T>;

/**
 * What a tracked container accepts for one element / value (a container also takes its plain form).
 *
 * @example
 * ```ts
 * type In = ElementInput<StrictArray<string>>; // StrictArray<string> | readonly string[]
 * ```
 */
export type ElementInput<V> = V extends { readonly [ENTITY]: infer S }
  ? SubdocumentInput<S>
  : V extends { readonly [SUBDOCUMENT_ELEMENT]: infer S }
    ? V | readonly SubdocumentInput<S>[]
    : V extends { readonly [STRICT_ELEMENT]: infer E }
      ? V | readonly ElementInput<E>[]
      : V extends TypedMap<infer M>
        ? V | ReadonlyMap<string, ElementInput<M>> | { readonly [key: string]: ElementInput<M> }
        : V;

/**
 * The `$`-methods of a hydrated subdocument or nested object (the one parent link).
 *
 * @example
 * ```ts
 * const address = user.address;
 * address.$set("city", "Oslo");
 * const root = address.$ownerDocument();
 * ```
 */
export interface SubdocumentMethods<T> {
  /** Phantom (type only, never present at run time): the entity class, so the plain and input forms can be derived. */
  readonly [ENTITY]: T;
  /** The nearest document that owns this one (a subdocument or the root), `undefined` when detached. */
  $parent(): object | undefined;
  /** The array holding this subdocument, `undefined` for a single subdocument or when detached. */
  $parentArray(): SubdocumentArray<T> | undefined;
  /** Position in the owning array right now (computed on every read, so never stale after a shift), -1 when not in an array. */
  $index(): number;
  /** Full code path inside the root document (`revisions.1`), `undefined` when detached. */
  $fullPath(): string | undefined;
  /** The root document, `undefined` when detached. */
  $ownerDocument(): object | undefined;
  /**
   * Whether the document this subdocument belongs to has not been inserted yet (`true` when detached): the same
   * answer as the owner document's `$isNew()`, so a document hook of the class may ask it either way.
   */
  $isNew(): boolean;
  /**
   * `false`: this is a subdocument, not a root document. In a document hook of the class, `if (this.$isRoot())`
   * narrows `this` to the root document.
   */
  $isRoot(): this is HydratedDoc<T>;
  /**
   * Whether a field of this subdocument (or `path`, or something under it) changed since the last load or save.
   *
   * @param path - Limits the check to this path, relative to the subdocument.
   */
  $isModified(path?: DocumentPaths<T>): boolean;
  /**
   * Replaces one field: the value is cast at once; a container becomes a new tracked value. The way to
   * replace a container or subdocument field, which the type does not let you assign directly.
   *
   * @param key - The field to replace.
   * @param value - The new value.
   * @returns This subdocument.
   * @throws {CastError} When the value cannot be cast to the field's type.
   */
  $set<K extends DataKeys<T>>(key: K, value: FieldInput<T[K]>): this;
  /** The object form: untracked data — arrays, `Map`s, plain objects; BSON values as they are. */
  $toObject(): ObjectDoc<T>;
  /**
   * The plain form: exactly what the document's `$toPlain()` gives at this path — ids, int64,
   * `Decimal128`, `UUID` as strings, `Date`/`RegExp`/`Map` kept; `Hidden` fields of subdocuments out unless
   * `{ hidden: true }`.
   *
   * @param options - Plain-form options.
   */
  $toPlain(options?: PlainFormOptions & { readonly hidden?: false }): Plain<T, false>;
  /**
   * The plain form with the `Hidden` fields of subdocuments included.
   *
   * @param options - Plain-form options with `hidden: true`.
   */
  $toPlain(options: PlainFormOptions & { readonly hidden: true }): Plain<T, true>;
}

/**
 * What `$set` accepts for a field of declared type `V`.
 *
 * @example
 * ```ts
 * type In = FieldInput<string | undefined>; // string
 * ```
 */
export type FieldInput<V> = InputOf<NoUndefined<V>>;

/**
 * A hydrated subdocument or nested object of class `T`: its hydrated fields plus the `$`-methods.
 *
 * @example
 * ```ts
 * const address: Subdocument<Address> = user.address;
 * ```
 */
export type Subdocument<T> = HydratedFields<T> & SubdocumentMethods<T>;

/**
 * The id a subdocument array takes to find or pull an element (`SubdocumentArray#id`, `#pull`): the `_id` type of
 * the subdocument class and its string form (`StringInputOf`: an `ObjectId` also as its hex string); `never`
 * without `_id`. The core casts it by the `_id` type of the element schema.
 *
 * @example
 * ```ts
 * type I = SubdocumentId<Line>; // ObjectId | string
 * ```
 */
export type SubdocumentId<T> = IdInputOf<T>;
