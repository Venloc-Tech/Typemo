/*
 * Inline type assertions for `test/types/**`. They complement `expect-type`:
 * `expectTypeOf` reads well for a value, these read well for a type computed from other
 * types (no value needed), and each failing assertion names what went wrong in the error.
 *
 * Usage: `type _ = Expect<AssertEqual<Actual, Expected>>;` — a failure is a compile error on
 * that line whose message contains the `TypeAssertionError` object with both sides printed.
 */

/**
 * `true` when `T` is exactly `any` (and not `unknown` or anything else).
 *
 * @example
 * ```ts
 * type _ = Expect<IsAny<any>>;
 * ```
 */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * `true` when `T` is exactly `never` (not distributed, so `never` is not swallowed).
 *
 * @example
 * ```ts
 * type _ = Expect<IsNever<never>>;
 * ```
 */
export type IsNever<T> = [T] extends [never] ? true : false;

/**
 * `true` when `T` is exactly `unknown` (`any` is excluded).
 *
 * @example
 * ```ts
 * type _ = Expect<IsUnknown<unknown>>;
 * ```
 */
export type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false;

/**
 * Exact type identity (the "invariant" check TypeScript uses for assignability of generic
 * functions): `{ a: 1 }` and `{ readonly a: 1 }` differ, `any` equals only `any`, and
 * `A | B` equals `B | A`. Mutual assignability is not enough because `any` passes it.
 *
 * @example
 * ```ts
 * type _ = Expect<IsEqual<string | number, number | string>>;
 * ```
 */
export type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * A readable failure payload: shows up verbatim in the compiler error of a failed `Expect`.
 *
 * @example
 * ```ts
 * type Failure = TypeAssertionError<"types are not identical", string, number>;
 * ```
 */
export interface TypeAssertionError<Message extends string, Actual = never, Expected = never> {
  /** What went wrong. */
  readonly error: Message;
  /** The type that was checked. */
  readonly actual: Actual;
  /** The type it was checked against. */
  readonly expected: Expected;
}

/**
 * Passes only for `true`; anything else (a `TypeAssertionError`, `false`, `boolean`) is a compile error here.
 *
 * @example
 * ```ts
 * type _ = Expect<AssertEqual<1, 1>>;
 * ```
 */
export type Expect<T extends true> = T;

/**
 * Passes only for `false`. Useful with the `Is*` predicates: `Expect<Not<IsAny<T>>>`.
 *
 * @example
 * ```ts
 * type _ = ExpectFalse<IsAny<string>>;
 * ```
 */
export type ExpectFalse<T extends false> = T;

/**
 * `true` when `T` is `false`, `false` when `T` is `true`.
 *
 * @example
 * ```ts
 * type _ = Expect<Not<IsAny<string>>>;
 * ```
 */
export type Not<T extends boolean> = T extends true ? false : true;

/**
 * `true` if `Actual` is identical to `Expected`, otherwise a {@link TypeAssertionError} with both sides.
 *
 * @example
 * ```ts
 * type _ = Expect<AssertEqual<{ a: 1 }, { a: 1 }>>;
 * ```
 */
export type AssertEqual<Actual, Expected> =
  IsEqual<Actual, Expected> extends true ? true : TypeAssertionError<"types are not identical", Actual, Expected>;

/**
 * `true` if `Actual` differs from `Unexpected`.
 *
 * @example
 * ```ts
 * type _ = Expect<AssertNotEqual<string, number>>;
 * ```
 */
export type AssertNotEqual<Actual, Unexpected> =
  IsEqual<Actual, Unexpected> extends true ? TypeAssertionError<"types must differ", Actual, Unexpected> : true;

/**
 * `true` if `T` is not `any`. `any` in a result type silently disables checking downstream.
 *
 * @example
 * ```ts
 * type _ = Expect<AssertNotAny<string>>;
 * ```
 */
export type AssertNotAny<T> = IsAny<T> extends true ? TypeAssertionError<"type is any", T> : true;

/**
 * `true` if `T` is `never` (for "this branch must be impossible" checks).
 *
 * @example
 * ```ts
 * type _ = Expect<AssertNever<never>>;
 * ```
 */
export type AssertNever<T> = IsNever<T> extends true ? true : TypeAssertionError<"type is not never", T, never>;

/**
 * `true` if `T` is not `never` (a result type collapsing to `never` is a common silent failure).
 *
 * @example
 * ```ts
 * type _ = Expect<AssertNotNever<string>>;
 * ```
 */
export type AssertNotNever<T> = IsNever<T> extends true ? TypeAssertionError<"type is never", T> : true;

/**
 * `true` if `T` is exactly `unknown`.
 *
 * @example
 * ```ts
 * type _ = Expect<AssertUnknown<unknown>>;
 * ```
 */
export type AssertUnknown<T> = IsUnknown<T> extends true ? true : TypeAssertionError<"type is not unknown", T, unknown>;

/**
 * `true` if `Actual` is assignable to `Target` (one direction only; `any` is rejected).
 *
 * @example
 * ```ts
 * type _ = Expect<AssertAssignable<"a", string>>;
 * ```
 */
export type AssertAssignable<Actual, Target> =
  IsAny<Actual> extends true
    ? TypeAssertionError<"type is any", Actual, Target>
    : [Actual] extends [Target]
      ? true
      : TypeAssertionError<"type is not assignable", Actual, Target>;

/**
 * `true` if `Actual` is NOT assignable to `Target`.
 *
 * @example
 * ```ts
 * type _ = Expect<AssertNotAssignable<string, number>>;
 * ```
 */
export type AssertNotAssignable<Actual, Target> = [Actual] extends [Target]
  ? TypeAssertionError<"type must not be assignable", Actual, Target>
  : true;

/**
 * `true` if `Key` is a known key of `T`.
 *
 * @example
 * ```ts
 * type _ = Expect<AssertHasKey<{ a: 1 }, "a">>;
 * ```
 */
export type AssertHasKey<T, Key extends PropertyKey> = Key extends keyof T
  ? true
  : TypeAssertionError<"key is missing", keyof T, Key>;

/**
 * `true` if `Key` is NOT a key of `T` (e.g. a projected-away field).
 *
 * @example
 * ```ts
 * type _ = Expect<AssertNoKey<{ a: 1 }, "b">>;
 * ```
 */
export type AssertNoKey<T, Key extends PropertyKey> = Key extends keyof T
  ? TypeAssertionError<"key must be absent", keyof T, Key>
  : true;

/**
 * `true` if the property `Key` of `T` is optional (`?`).
 *
 * @example
 * ```ts
 * type _ = Expect<AssertOptionalKey<{ a?: 1 }, "a">>;
 * ```
 */
export type AssertOptionalKey<T, Key extends keyof T> =
  /* `{}` is assignable to `Pick<T, Key>` only when `Key` is optional. */
  // biome-ignore lint/complexity/noBannedTypes: `{}` is the empty object type on purpose here.
  {} extends Pick<T, Key> ? true : TypeAssertionError<"key is required", Key, "optional">;

/**
 * `true` if the property `Key` of `T` is required.
 *
 * @example
 * ```ts
 * type _ = Expect<AssertRequiredKey<{ a: 1 }, "a">>;
 * ```
 */
export type AssertRequiredKey<T, Key extends keyof T> =
  // biome-ignore lint/complexity/noBannedTypes: `{}` is the empty object type on purpose here.
  {} extends Pick<T, Key> ? TypeAssertionError<"key is optional", Key, "required"> : true;
