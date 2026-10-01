import type { OpaqueValue } from "../bson/opaque-value.ts";
import type { IsVirtualRef, IsVirtualValue } from "./markers.ts";

/*
 * Paths of an entity for the class-level decorators (`@Index`, `@Schema({ timeseries })`,
 * `@Virtual({ localField })`). Deliberately small and depth-limited: the decorators only need names.
 */

/**
 * Keys of `T` that are stored data: no methods, no virtuals (`Computed`, `VirtualValue`, `VirtualRef`).
 *
 * @typeParam T - The entity class type.
 * @example
 * class User { name!: string; save(): void {} }
 * type A = DataKeys<User>; // "name"
 */
export type DataKeys<T> = {
  /* `[…] extends [never]` first: a key typed only `undefined` (an absent key) is data; a bare `never` would match
     the function test. */
  [K in keyof T & string]-?: [NonNullable<T[K]>] extends [never]
    ? K
    : NonNullable<T[K]> extends (...args: never) => unknown
      ? never
      : IsVirtualRef<T[K]> extends true
        ? never
        : IsVirtualValue<T[K]> extends true
          ? never
          : K;
}[keyof T & string];

/**
 * A value a path does not walk into.
 *
 * @example
 * const a: Leaf = "text";
 */
type Leaf = string | number | boolean | bigint | null | undefined | OpaqueValue;

/**
 * Dotted paths of `T` (through subdocuments and arrays of subdocuments), to a depth of 4.
 *
 * @typeParam T - The entity type.
 * @typeParam Depth - The recursion counter; callers leave it at its default.
 * @example
 * type A = SchemaPaths<{ name: string; address: { zip: string } }>; // "name" | "address" | "address.zip"
 */
export type SchemaPaths<T, Depth extends unknown[] = []> = Depth["length"] extends 4
  ? never
  : {
      [K in DataKeys<T>]: NonNullable<T[K]> extends Leaf
        ? K
        : NonNullable<T[K]> extends readonly (infer E)[]
          ? K | (NonNullable<E> extends Leaf ? never : `${K}.${SchemaPaths<NonNullable<E>, [...Depth, unknown]>}`)
          : K | `${K}.${SchemaPaths<NonNullable<T[K]>, [...Depth, unknown]>}`;
    }[DataKeys<T>];

/**
 * Top-level data keys of `T` whose (non-null) type is assignable to `V`.
 *
 * @typeParam T - The entity type.
 * @typeParam V - The value type the keys must hold.
 * @example
 * type A = KeysOfType<{ name: string; age: number }, string>; // "name"
 */
export type KeysOfType<T, V> = {
  [K in DataKeys<T>]-?: [NonNullable<T[K]>] extends [V] ? K : never;
}[DataKeys<T>];
