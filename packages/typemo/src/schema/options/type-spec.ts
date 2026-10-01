import type { Binary, Decimal128, ObjectId, Timestamp, UUID } from "mongodb";
import type { Vector } from "../../bson/bson-type-table.ts";
import type { VectorDtype } from "../../bson/casters/vector-caster.ts";

/*
 * The runtime type of a field: what `@Prop(() => T)` returns. It is explicit on every field;
 * `design:type` is never read. One value describes the whole field, so the type check of the
 * decorator (`SpecValue<S>` against the declared field type) sees everything in one place:
 *
 * | spec                                   | field type (`SpecValue`)          | BSON                 |
 * |----------------------------------------|-----------------------------------|----------------------|
 * | `String` / `Boolean` / `Date`          | `string` / `boolean` / `Date`     | string / bool / date |
 * | `Number`                               | `number`                          | int32 or double      |
 * | `Types.Double` / `Types.Int32`         | `number`                          | double / int         |
 * | `BigInt`                               | `bigint`                          | long                 |
 * | `Types.ObjectId` / `Types.UUID`        | `ObjectId` / `UUID`               | objectId / binData 4 |
 * | `Types.Decimal128` / `Types.Timestamp` | `Decimal128` / `Timestamp`        | decimal / timestamp  |
 * | `Types.Binary`, `Spec.binary({ subtype })` | `Binary`                      | binData              |
 * | `Spec.vector({ dtype, dimensions })`   | `Vector` (a marked `Binary`)      | binData 9            |
 * | `RegExp`                               | `RegExp`                          | regex                |
 * | `[X]`                                  | `SpecValue<X>[]`                  | array                |
 * | `Spec.map(X)`                          | `Map<string, SpecValue<X>>`       | object               |
 * | `Spec.map(X, { nullable: true })`      | `Map<string, SpecValue<X> \| null>`| object (null values) |
 * | `Spec.union(X, Y, …)` (scalars)        | `SpecValue<X> \| SpecValue<Y>`    | per member           |
 * | a class with `@Schema`                 | its instance type (exact)         | object               |
 */

/** The brand of the spec objects built by {@link Spec}. */
export const SPEC_KIND: unique symbol = Symbol("typemo.spec");

/** The type-only key of {@link MapSpec} that carries the literal `nullable` flag (no value at run time). */
declare const MAP_NULLABLE: unique symbol;

/**
 * A class usable as a schema: constructible without arguments, abstract allowed.
 *
 * @example
 * ```ts
 * const model: EntityClass<User> = User;
 * ```
 */
export type EntityClass<I extends object = object> = abstract new () => I;

/**
 * A BSON class of the driver, recognized by the literal `_bsontype` of its instances.
 *
 * @example
 * ```ts
 * const spec: BsonClass<"ObjectId"> = ObjectId;
 * ```
 */
export type BsonClass<Tag extends string> = abstract new (...args: never) => { readonly _bsontype: Tag };

/**
 * Scalar specs: built-in constructors and the driver's BSON classes (`Types.*`).
 *
 * @example
 * ```ts
 * const spec: ScalarSpec = String;
 * ```
 */
export type ScalarSpec =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | BigIntConstructor
  | DateConstructor
  | RegExpConstructor
  | typeof UUID
  | BsonClass<"ObjectId">
  | BsonClass<"Decimal128">
  | BsonClass<"Double">
  | BsonClass<"Int32">
  | BsonClass<"Timestamp">
  | BsonClass<"Binary">;

/**
 * `Spec.map(X)`: a `Map<string, V>` stored as an embedded document. With `Spec.map(X, { nullable: true })`
 * `null` is a value of the map (`Map<string, V | null>`), stored as BSON null.
 *
 * @example
 * ```ts
 * const spec: MapSpec<StringConstructor, false> = Spec.map(String);
 * ```
 */
export interface MapSpec<V = unknown, Nullable extends boolean = false> {
  /** The spec kind brand. */
  readonly [SPEC_KIND]: "map";
  /** The spec of the map values. */
  readonly of: V;
  /**
   * The `nullable` option as it was given: `true` makes `null` a value of the map; absent, it is not. Any other value
   * (a JavaScript caller writing `false` or `"yes"`, a spec written by hand) is a `ConfigurationError` when the schema
   * is built, never read as "absent".
   */
  readonly nullable?: unknown;
  /** Type only: whether the field type admits `null` values (`Map<string, V | null>`). */
  readonly [MAP_NULLABLE]?: Nullable;
}

/**
 * The overloads of `Spec.map`: the literal `nullable` flag is kept in the spec type.
 *
 * @example
 * ```ts
 * const builder: MapSpecBuilder = Spec.map;
 * ```
 */
export interface MapSpecBuilder {
  <const V extends TypeSpec>(of: V): MapSpec<V, false>;
  <const V extends TypeSpec>(of: V, options: { readonly nullable: true }): MapSpec<V, true>;
  <const V extends TypeSpec>(of: V, options: MapSpecOptions): MapSpec<V, boolean>;
}

/**
 * Options of `Spec.map`.
 *
 * @example
 * ```ts
 * const options: MapSpecOptions = { nullable: true };
 * ```
 */
export interface MapSpecOptions {
  /** `null` is a value of the map (declare the field `Map<string, V | null>`). */
  readonly nullable?: true;
}

/**
 * `Spec.vector({ dtype, dimensions })`: BSON vector (Binary subtype 9).
 *
 * @example
 * ```ts
 * const spec: VectorSpec = Spec.vector({ dtype: "float32", dimensions: 3 });
 * ```
 */
export interface VectorSpec {
  /** The spec kind brand. */
  readonly [SPEC_KIND]: "vector";
  /** The element type of the vector. */
  readonly dtype: VectorDtype;
  /** The exact number of elements, when fixed. */
  readonly dimensions?: number;
}

/**
 * `Spec.binary({ subtype })`: Binary of a given subtype (0 is `Types.Binary`).
 *
 * @example
 * ```ts
 * const spec: BinarySpec = Spec.binary({ subtype: 128 });
 * ```
 */
export interface BinarySpec {
  /** The spec kind brand. */
  readonly [SPEC_KIND]: "binary";
  /** The Binary subtype. */
  readonly subtype: number;
}

/**
 * `Spec.union(X, Y, …)`: a union of scalar types, the member chosen by the value's own type.
 *
 * @example
 * ```ts
 * const spec: UnionSpec = Spec.union(String, Number);
 * ```
 */
export interface UnionSpec<M extends readonly ScalarSpec[] = readonly ScalarSpec[]> {
  /** The spec kind brand. */
  readonly [SPEC_KIND]: "union";
  /** The member specs. */
  readonly members: M;
}

/**
 * Everything `@Prop(() => …)` may return. Deliberately not recursive (`readonly [unknown]`, not
 * `readonly [TypeSpec]`): a recursive union makes the constraint `PropOptions<S extends TypeSpec>`
 * infinitely deep (TS2589). An invalid element makes `SpecValue` `never`, which the field check reports.
 *
 * @example
 * ```ts
 * const spec: TypeSpec = [String];
 * ```
 */
export type TypeSpec =
  | ScalarSpec
  | EntityClass
  | readonly [unknown]
  | MapSpec<unknown, boolean>
  | VectorSpec
  | BinarySpec
  | UnionSpec;

/**
 * Built-in constructors that are newable (so they fit `EntityClass`) but are not field types. Checked
 * before the class branch so that `@Prop(() => Set)` is a type error, not a `Set<unknown>` field.
 *
 * @example
 * ```ts
 * type Value = SpecValue<SetConstructor>; // never
 * ```
 */
export type UnsupportedSpec =
  | SetConstructor
  | MapConstructor
  | ArrayConstructor
  | ObjectConstructor
  | FunctionConstructor
  | PromiseConstructor
  | WeakMapConstructor
  | WeakSetConstructor
  | SymbolConstructor
  | ErrorConstructor;

/**
 * The field type a spec produces (the hydrated form of `BsonTypeTable`).
 *
 * @example
 * ```ts
 * type Name = SpecValue<StringConstructor>; // string
 * ```
 */
export type SpecValue<S> = S extends UnsupportedSpec
  ? never
  : S extends StringConstructor
    ? string
    : S extends NumberConstructor
      ? number
      : S extends BooleanConstructor
        ? boolean
        : S extends BigIntConstructor
          ? bigint
          : S extends DateConstructor
            ? Date
            : S extends RegExpConstructor
              ? RegExp
              : S extends typeof UUID
                ? UUID
                : S extends BsonClass<"ObjectId">
                  ? ObjectId
                  : S extends BsonClass<"Decimal128">
                    ? Decimal128
                    : S extends BsonClass<"Double"> | BsonClass<"Int32">
                      ? number
                      : S extends BsonClass<"Timestamp">
                        ? Timestamp
                        : S extends BsonClass<"Binary">
                          ? Binary
                          : S extends readonly [infer E]
                            ? SpecValue<E>[]
                            : S extends MapSpec<infer V, infer N>
                              ? Map<string, SpecValue<V> | ([N] extends [true] ? null : never)>
                              : S extends VectorSpec
                                ? Vector
                                : S extends BinarySpec
                                  ? Binary
                                  : S extends UnionSpec<infer M>
                                    ? SpecValue<M[number]>
                                    : S extends EntityClass<infer I>
                                      ? I
                                      : never;

/**
 * The element spec of an array spec (`[X]` → `X`), the spec itself otherwise.
 *
 * @example
 * ```ts
 * type Element = ElementSpec<[StringConstructor]>; // StringConstructor
 * ```
 */
export type ElementSpec<S> = S extends readonly [infer E] ? ElementSpec<E> : S;

/**
 * Builders of the composite specs. Spec objects are frozen data; the compiler reads them.
 * The outer thunk of `@Prop(() => …)` is already lazy, so members need no thunks of their own:
 * `@Prop(() => Spec.map(Address))` is safe against declaration order.
 */
export class Spec {
  /**
   * `Map<string, V>` (stored as an embedded document; keys are checked by `MapCaster`). With
   * `{ nullable: true }` a value may be `null` (Mongoose gh-9628): `Map<string, V | null>`.
   *
   * @param of - The spec of the map values.
   * @param options - `{ nullable: true }` allows `null` values.
   * @returns A frozen map spec.
   */
  static readonly map: MapSpecBuilder = ((of: TypeSpec, options?: MapSpecOptions): MapSpec<TypeSpec, boolean> => {
    /* The option is kept as given, not coerced: the compiler rejects anything but true (a JavaScript caller
       writing { nullable: false } or { nullable: "yes" } must hear about it when the schema is built). */
    const given: unknown = options?.nullable;
    return Object.freeze({ [SPEC_KIND]: "map" as const, of, ...(given === undefined ? {} : { nullable: given }) });
  }) as MapSpecBuilder;

  /**
   * BSON vector of a dtype, optionally of exactly `dimensions` elements (checked by `VectorCaster`).
   *
   * @param options - The element type and the optional exact number of elements.
   * @returns A frozen vector spec.
   */
  static vector(options: { readonly dtype: VectorDtype; readonly dimensions?: number }): VectorSpec {
    return Object.freeze({ [SPEC_KIND]: "vector" as const, ...options });
  }

  /**
   * Binary of a subtype other than 0 (`Types.Binary` is subtype 0; 4 is `Types.UUID`, 9 is `Spec.vector`).
   *
   * @param options - The Binary subtype.
   * @returns A frozen binary spec.
   */
  static binary(options: { readonly subtype: number }): BinarySpec {
    return Object.freeze({ [SPEC_KIND]: "binary" as const, subtype: options.subtype });
  }

  /**
   * A union of scalar types: the member is chosen by the runtime type of the value, and exactly
   * one member must accept it (checked by `UnionCaster`). Members that accept the same values
   * (`Number` and `Types.Int32`) are a build error. Unions of classes are discriminators (`@Discriminator`).
   *
   * @param members - At least two scalar specs.
   * @returns A frozen union spec.
   */
  static union<const M extends readonly [ScalarSpec, ScalarSpec, ...ScalarSpec[]]>(...members: M): UnionSpec<M> {
    return Object.freeze({ [SPEC_KIND]: "union" as const, members });
  }

  /**
   * Recognises the objects built by `Spec.*`.
   *
   * @param value - Any value returned by a `@Prop` type thunk.
   * @returns `true` when `value` is a spec object.
   */
  static isSpecObject(value: unknown): value is MapSpec<unknown, boolean> | VectorSpec | BinarySpec | UnionSpec {
    return typeof value === "object" && value !== null && SPEC_KIND in value;
  }
}
