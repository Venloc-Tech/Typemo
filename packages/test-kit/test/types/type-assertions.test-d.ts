// biome-ignore-all lint/suspicious/noExplicitAny: the assertions are tested against `any` on purpose.
/*
 * Type tests of the inline assertions themselves. Compiled by `bun run test:types`
 * (tsconfig.test.json) and by `type-check-runner.test.ts` inside `bun test`.
 */
import { expectTypeOf } from "expect-type";
import type {
  AssertAssignable,
  AssertEqual,
  AssertHasKey,
  AssertNever,
  AssertNoKey,
  AssertNotAny,
  AssertNotAssignable,
  AssertNotEqual,
  AssertNotNever,
  AssertOptionalKey,
  AssertRequiredKey,
  AssertUnknown,
  Expect,
  ExpectFalse,
  IsAny,
  IsEqual,
  IsNever,
  IsUnknown,
  Not,
} from "../../src/types/type-assertions.ts";

/** The entity the assertions are applied to. */
interface User {
  /** Required name. */
  name: string;
  /** Optional age. */
  age?: number;
  /** Read-only id. */
  readonly id: string;
}

/** The `Is*` predicates and `Not`. */
export type PredicateCases = [
  Expect<IsAny<any>>,
  ExpectFalse<IsAny<unknown>>,
  ExpectFalse<IsAny<never>>,
  ExpectFalse<IsAny<string>>,
  Expect<IsNever<never>>,
  ExpectFalse<IsNever<undefined>>,
  Expect<IsUnknown<unknown>>,
  ExpectFalse<IsUnknown<any>>,
  Expect<IsEqual<"a" | "b", "b" | "a">>,
  ExpectFalse<IsEqual<{ a: 1 }, { readonly a: 1 }>>,
  ExpectFalse<IsEqual<any, string>>,
  ExpectFalse<IsEqual<string | undefined, string>>,
  Expect<Not<false>>,
];

/** Assertions that must hold. */
export type PositiveCases = [
  Expect<AssertEqual<User["name"], string>>,
  Expect<AssertNotEqual<User["age"], number>>,
  Expect<AssertNotAny<User>>,
  Expect<AssertNever<Extract<keyof User, "nope">>>,
  Expect<AssertNotNever<keyof User>>,
  Expect<AssertUnknown<unknown>>,
  Expect<AssertAssignable<"x", string>>,
  Expect<AssertNotAssignable<string, "x">>,
  Expect<AssertHasKey<User, "name">>,
  Expect<AssertNoKey<User, "email">>,
  Expect<AssertOptionalKey<User, "age">>,
  Expect<AssertRequiredKey<User, "name">>,
];

expectTypeOf<User>().toHaveProperty("name").toEqualTypeOf<string>();

/* Negative assertions: each line must fail for the stated reason. */

// @ts-expect-error `any` is not identical to `string`: AssertEqual yields a TypeAssertionError, not `true`.
export type NegEqualAny = Expect<AssertEqual<any, string>>;
// @ts-expect-error optionality differs: `number | undefined` is not `number`.
export type NegEqualOptional = Expect<AssertEqual<User["age"], number>>;
// @ts-expect-error readonly-ness differs: `{ readonly a: 1 }` is not `{ a: 1 }`.
export type NegEqualReadonly = Expect<AssertEqual<{ readonly a: 1 }, { a: 1 }>>;
// @ts-expect-error the type is `any`: AssertNotAny must reject it.
export type NegNotAny = Expect<AssertNotAny<any>>;
// @ts-expect-error `string` is not `never`.
export type NegNever = Expect<AssertNever<string>>;
// @ts-expect-error `never` must be reported by AssertNotNever.
export type NegNotNever = Expect<AssertNotNever<never>>;
// @ts-expect-error `any` is rejected by AssertAssignable even though it is assignable to everything.
export type NegAssignableAny = Expect<AssertAssignable<any, number>>;
// @ts-expect-error `string` is not assignable to `"x"`.
export type NegAssignable = Expect<AssertAssignable<string, "x">>;
// @ts-expect-error `email` is not a key of User.
export type NegHasKey = Expect<AssertHasKey<User, "email">>;
// @ts-expect-error `name` is a key of User.
export type NegNoKey = Expect<AssertNoKey<User, "name">>;
// @ts-expect-error `name` is required, not optional.
export type NegOptional = Expect<AssertOptionalKey<User, "name">>;
// @ts-expect-error `age` is optional, not required.
export type NegRequired = Expect<AssertRequiredKey<User, "age">>;
