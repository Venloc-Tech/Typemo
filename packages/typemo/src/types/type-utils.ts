/*
 * Small type utilities. Every one of them is non-recursive or bounded: they sit inside the query
 * types of every call, so they must stay cheap for the compiler.
 */

/**
 * Flattens an intersection so hover prints the fields, not the alias.
 *
 * @typeParam T - The type to flatten.
 * @example
 * type A = Simplify<{ a: 1 } & { b: 2 }>; // { a: 1; b: 2 }
 */
export type Simplify<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

/**
 * A type-level decrementing depth counter; indexing it with a depth gives the next lower one.
 *
 * @example
 * type A = Dec[7]; // 6
 * type B = Dec[1]; // 0
 * type C = Dec[0]; // never
 */
export type Dec = [never, 0, 1, 2, 3, 4, 5, 6, 7];

/**
 * Union to intersection (through parameter contravariance).
 *
 * @typeParam U - The union.
 * @example
 * type A = UnionToIntersection<{ a: 1 } | { b: 2 }>; // { a: 1 } & { b: 2 }
 */
export type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

/**
 * A non-empty readonly list: `$and`/`$or`/`$nor` (an empty one is rejected by the server).
 *
 * @typeParam T - The element type.
 * @example
 * const a: NonEmptyArray<number> = [1, 2];
 * // const b: NonEmptyArray<number> = []; // error
 */
export type NonEmptyArray<T> = readonly [T, ...T[]];

/**
 * `true` when `A` and `B` are mutually assignable (non-distributive).
 *
 * @typeParam A - The first type.
 * @typeParam B - The second type.
 * @example
 * type A = Same<string, string>; // true
 * type B = Same<string, "a">; // false
 */
export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * `true` for `any` (used only to refuse it: public inputs never accept `any` silently).
 *
 * @typeParam T - The type to test.
 * @example
 * type A = IsAny<unknown>; // false
 * type B = IsAny<string>; // false (only the untyped escape hatch gives true)
 */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * The element type of a (readonly) array, recursively for arrays of arrays; `T` itself otherwise.
 *
 * @typeParam T - The array or scalar type.
 * @example
 * type A = Element<string[][]>; // string
 * type B = Element<number>; // number
 */
export type Element<T> = T extends readonly (infer E)[] ? Element<E> : T;

/**
 * The string keys of `T`.
 *
 * @typeParam T - The object type.
 * @example
 * type A = StringKeys<{ a: 1; [Symbol.iterator]: 2 }>; // "a"
 */
export type StringKeys<T> = Extract<keyof T, string>;

/**
 * Keys of `T` whose value type is optional (`?:` or `| undefined`).
 *
 * @typeParam T - The object type.
 * @example
 * type A = OptionalKeys<{ a: 1; b?: 2 }>; // "b"
 */
export type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];
