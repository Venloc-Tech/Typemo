import type { IsPlainObject } from "../bson/opaque-value.ts";
import type { Dec, Simplify, UnionToIntersection } from "./type-utils.ts";

/*
 * The EXACT contract check, types only (zero runtime cost). `ContractCheck<Actual, Expected>` is `true`
 * when the two types have exactly the same fields, optionality, `null`s and values, at every depth
 * (objects, arrays, unions of objects — discriminators); otherwise an object that names every problem by path:
 *   { missing: "email" }        a field of the contract the actual type lacks;
 *   { extra: "password" }       a field the actual type has and the contract does not (ALWAYS an error: an
 *                               assignment would silently drop it);
 *   { mismatch: "age" }         a different value type, `null`, optionality, or a union member without a twin.
 * Paths are dotted, an array element is `[]` (`comments[].author`), the value itself is `(root)`.
 * Readonly-ness is not compared (a contract is about data, `lean()` rows are mutable).
 */

/**
 * `true` for a value the contract walks field by field (an array or a plain object); other values are
 * compared as a whole.
 *
 * @typeParam V - The value type.
 * @example
 * type A = IsWalked<{ a: 1 }>; // true
 * type B = IsWalked<string>; // false
 */
type IsWalked<V> = V extends readonly unknown[] ? true : true extends IsPlainObject<V> ? true : false;

/**
 * `true` when `T` is a union of more than one member.
 *
 * @typeParam T - The type to test.
 * @example
 * type A = IsUnion<"a" | "b">; // true
 * type B = IsUnion<"a">; // false
 */
type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;

/**
 * `true` when `A` and `B` are mutually assignable (non-distributive).
 *
 * @typeParam A - The first type.
 * @typeParam B - The second type.
 * @example
 * type A = Same<string, string>; // true
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * The printable form of a path: the empty path is `(root)`.
 *
 * @typeParam P - The path.
 * @example
 * type A = At<"">; // "(root)"
 * type B = At<"a.b">; // "a.b"
 */
type At<P extends string> = P extends "" ? "(root)" : P;
/**
 * Appends key `K` to path `P`.
 *
 * @typeParam P - The path so far.
 * @typeParam K - The key.
 * @example
 * type A = Join<"", "a">; // "a"
 * type B = Join<"a", "b">; // "a.b"
 */
type Join<P extends string, K extends string> = P extends "" ? K : `${P}.${K}`;

/**
 * The keys of `T` that are not optional.
 *
 * @typeParam T - The object type.
 * @example
 * type A = RequiredKeys<{ a: 1; b?: 2 }>; // "a"
 */
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];

/**
 * `V` without `undefined` (optionality is compared apart from the value).
 *
 * @typeParam V - The value type.
 * @example
 * type A = NoUndefined<string | undefined>; // string
 */
type NoUndefined<V> = V extends undefined ? never : V;

/**
 * The problems of `A` against `E` at path `P`, as tagged strings (`missing:email`), `never` when exact.
 *
 * @typeParam A - The actual type.
 * @typeParam E - The expected type.
 * @typeParam P - The path so far.
 * @typeParam D - The remaining depth.
 * @example
 * type X = DiffValue<{ a: 1 }, { a: 1; b: 2 }, "", 7>; // "missing:b"
 */
type DiffValue<A, E, P extends string, D extends number> = [D] extends [0]
  ? Same<A, E> extends true
    ? never
    : `mismatch:${At<P>}`
  : Same<Extract<A, null | undefined>, Extract<E, null | undefined>> extends true
    ? DiffNonNull<NonNullable<A>, NonNullable<E>, P, D>
    : `mismatch:${At<P>}`;

/**
 * The problems of the non-null parts of `A` against `E`: scalars are compared as a whole, objects and
 * arrays are walked, unions are matched member by member.
 *
 * @typeParam A - The actual type without `null`/`undefined`.
 * @typeParam E - The expected type without `null`/`undefined`.
 * @typeParam P - The path so far.
 * @typeParam D - The remaining depth.
 * @example
 * type X = DiffNonNull<string, number, "age", 7>; // "mismatch:age"
 */
type DiffNonNull<A, E, P extends string, D extends number> = [A] extends [never]
  ? [E] extends [never]
    ? never
    : `mismatch:${At<P>}`
  : [E] extends [never]
    ? `mismatch:${At<P>}`
    : IsWalked<A> | IsWalked<E> extends false
      ? Same<A, E> extends true
        ? never
        : `mismatch:${At<P>}`
      : IsUnion<A> | IsUnion<E> extends false
        ? DiffWalked<A, E, P, D>
        : DiffUnion<A, E, P, D>;

/**
 * The problems of a walked value: an array against an array (element by element), an object against an
 * object (field by field), any other pairing is a mismatch.
 *
 * @typeParam A - The actual type.
 * @typeParam E - The expected type.
 * @typeParam P - The path so far.
 * @typeParam D - The remaining depth.
 * @example
 * type X = DiffWalked<string[], number[], "tags", 7>; // "mismatch:tags[]"
 */
type DiffWalked<A, E, P extends string, D extends number> = A extends readonly (infer AE)[]
  ? E extends readonly (infer EE)[]
    ? DiffValue<AE, EE, `${P}[]`, Dec[D]>
    : `mismatch:${At<P>}`
  : E extends readonly unknown[]
    ? `mismatch:${At<P>}`
    : IsWalked<A> | IsWalked<E> extends true
      ? DiffObject<A, E, P, D>
      : `mismatch:${At<P>}`;

/**
 * The problems of an object against an object: fields only in `E` are `missing`, fields only in `A` are
 * `extra`, shared fields must agree in optionality and value.
 *
 * @typeParam A - The actual object type.
 * @typeParam E - The expected object type.
 * @typeParam P - The path so far.
 * @typeParam D - The remaining depth.
 * @example
 * type X = DiffObject<{ a: 1; c: 3 }, { a: 1; b: 2 }, "", 7>; // "missing:b" | "extra:c"
 */
type DiffObject<A, E, P extends string, D extends number> =
  | { [K in Exclude<keyof E, keyof A> & string]: `missing:${Join<P, K>}` }[Exclude<keyof E, keyof A> & string]
  | { [K in Exclude<keyof A, keyof E> & string]: `extra:${Join<P, K>}` }[Exclude<keyof A, keyof E> & string]
  | {
      [K in Extract<keyof A, keyof E> & string]: Same<
        K extends RequiredKeys<A> ? true : false,
        K extends RequiredKeys<E> ? true : false
      > extends true
        ? DiffValue<NoUndefined<A[K]>, NoUndefined<E[K & keyof E]>, Join<P, K>, Dec[D]>
        : `mismatch:${Join<P, K>}`;
    }[Extract<keyof A, keyof E> & string];

/**
 * Every member of `A` has an exact twin in `E` and the other way round; otherwise one mismatch at the path.
 *
 * @typeParam A - The actual union.
 * @typeParam E - The expected union.
 * @typeParam P - The path so far.
 * @typeParam D - The remaining depth.
 * @example
 * type X = DiffUnion<{ t: "a" } | { t: "b" }, { t: "a" }, "shape", 7>; // "mismatch:shape"
 */
type DiffUnion<A, E, P extends string, D extends number> = [Unmatched<A, E, P, D> | Unmatched<E, A, P, D>] extends [
  never,
]
  ? never
  : `mismatch:${At<P>}`;

/**
 * The members of `A` that have no exact twin among the members of `E`.
 *
 * @typeParam A - The union whose members are looked up.
 * @typeParam E - The union searched for twins.
 * @typeParam P - The path so far.
 * @typeParam D - The remaining depth.
 * @example
 * type X = Unmatched<{ t: "a" } | { t: "b" }, { t: "a" }, "", 7>; // { t: "b" }
 */
type Unmatched<A, E, P extends string, D extends number> = A extends unknown
  ? true extends (E extends unknown ? ([DiffNonNull<A, E, P, D>] extends [never] ? true : false) : never)
    ? never
    : A
  : never;

/**
 * The paths of the tagged problems with tag `Tag`.
 *
 * @typeParam Tags - The union of tagged problems.
 * @typeParam Tag - The tag to select.
 * @example
 * type A = Tagged<"missing:a" | "extra:b", "missing">; // "a"
 */
type Tagged<Tags, Tag extends string> = Tags extends `${Tag}:${infer P}` ? P : never;

/**
 * One property of the report (`{ missing: paths }`), or nothing when there is no problem of that kind.
 *
 * @typeParam Tags - The union of tagged problems.
 * @typeParam Tag - The tag of the property.
 * @example
 * type A = Part<"missing:a", "missing">; // { readonly missing: "a" }
 * type B = Part<"missing:a", "extra">; // unknown
 */
type Part<Tags, Tag extends string> = [Tagged<Tags, Tag>] extends [never]
  ? unknown
  : { readonly [K in Tag]: Tagged<Tags, Tag> };

/**
 * The readable report of a failed contract check: which paths are missing, extra or mismatched.
 *
 * @typeParam Tags - The union of tagged problems.
 * @example
 * type A = ContractMismatch<"missing:email" | "extra:password">; // { missing: "email"; extra: "password" }
 */
export type ContractMismatch<Tags> = Simplify<Part<Tags, "missing"> & Part<Tags, "extra"> & Part<Tags, "mismatch">>;

/**
 * `true` when `Actual` is EXACTLY `Expected` (fields, optionality, `null`, values, at every depth up to `Depth`),
 * otherwise a {@link ContractMismatch} naming the paths (`{ missing: "email"; extra: "password" }`).
 *
 * @typeParam Actual - The type to check.
 * @typeParam Expected - The contract.
 * @typeParam Depth - The deepest level compared.
 * @example
 * type A = ContractCheck<{ id: string }, { id: string }>; // true
 * type B = ContractCheck<{ id: string; pw: string }, { id: string }>; // { extra: "pw" }
 */
export type ContractCheck<Actual, Expected, Depth extends number = 7> = [
  DiffValue<Actual, Expected, "", Depth>,
] extends [never]
  ? true
  : ContractMismatch<DiffValue<Actual, Expected, "", Depth>>;

/**
 * The `this` of `.expect<Shape>()`: `unknown` (any receiver) when the rows are exactly `Shape`, otherwise the
 * mismatch report — the call is then a compile error that prints it.
 *
 * @typeParam Row - The row type of the query.
 * @typeParam Shape - The expected row shape.
 * @example
 * type A = ExpectRows<{ id: string }, { id: string }>; // unknown
 * type B = ExpectRows<{ id: string }, { id: number }>; // { mismatch: "id" }
 */
export type ExpectRows<Row, Shape> = ContractCheck<Row, Shape> extends true ? unknown : ContractCheck<Row, Shape>;

/**
 * The exact contract check of values: types only, the identity at run time.
 *
 * @example
 * const json = Contract.check<UserJson>()(user.$toJSON()); // a compile error if the JSON form is not exactly UserJson
 */
export class Contract {
  /**
   * `Contract.check<Expected>()(value)`: `value` itself, typed `Expected` — a compile error unless the value's type is
   * EXACTLY `Expected` (a missing, an extra or a mismatched field; the error prints `{ missing | extra | mismatch }`).
   *
   * @typeParam Expected - The contract the value must match exactly.
   * @returns A function that takes the value and returns it unchanged, typed `Expected`.
   * @example
   * const user = Contract.check<{ id: string }>()({ id: "1" });
   */
  static check<Expected>() {
    return <V>(value: V & (ContractCheck<V, Expected> extends true ? unknown : ContractCheck<V, Expected>)): Expected =>
      /* Exact: `V` is `Expected` field for field; the compiler cannot see it through the conditional type. */
      value as unknown as Expected;
  }
}
