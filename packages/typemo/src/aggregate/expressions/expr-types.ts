import type { OpaqueValue } from "../../bson/opaque-value.ts";
import type { ExprNode } from "./expr-node.ts";

/*
 * Type-level building blocks of the operator layer.
 *
 * The rule they encode: MongoDB does not fail on a `null` or missing input, it returns `null` (or
 * leaves the field out). An operator's result type therefore depends on what its ARGUMENTS can be:
 * `fn.add(f.age, 1)` is `number`, `fn.add(f.age, f.score)` with an optional `score` is
 * `number | null`. Operators take their arguments as opaque type parameters (`A extends Arg<…>`)
 * and hand them to `PropagateNull`.
 */

/**
 * Any bare (non-node) value in an expression position: a literal, a BSON value, an object or array literal.
 *
 * @example
 * ```ts
 * const values: BareValue[] = ["a", 1, null, new Date(), [1, 2], { a: 1 }];
 * ```
 */
export type BareValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | OpaqueValue
  | readonly unknown[]
  | { readonly [key: string]: unknown };

/**
 * A bare value of type `V`. For an operator that takes ANY value (`$type`, `$isArray`, `$toString`)
 * `V` is `unknown`; then the bare branch is `BareValue`, which a node does not match — so a node
 * without the `"expr"` capability (an accumulator, a window function) is still rejected there.
 *
 * @typeParam V - The value type.
 * @example
 * ```ts
 * type A = Bare<number>; // number
 * type B = Bare<unknown>; // BareValue
 * ```
 */
type Bare<V> = unknown extends V ? BareValue : V;

/**
 * An operator argument: an expression node usable as an expression, or a bare value.
 *
 * @typeParam V - The value type the operator expects.
 * @example
 * ```ts
 * type A = Arg<number>; // ExprNode<number, "expr"> | number
 * ```
 */
export type Arg<V> = ExprNode<V, "expr"> | Bare<V>;

/**
 * `V` widened with `null` and `undefined`: what an optional field can hold.
 *
 * @typeParam V - The value type.
 * @example
 * ```ts
 * type A = Nullable<number>; // number | null | undefined
 * ```
 */
export type Nullable<V> = V | null | undefined;

/**
 * The value type of an argument: `V` of a node, the type itself for a bare value.
 *
 * @typeParam A - The argument type.
 * @example
 * ```ts
 * type A = ArgValue<ExprNode<number>>; // number
 * type B = ArgValue<string>; // string
 * ```
 */
export type ArgValue<A> = A extends ExprNode<infer V, never> ? V : A;

/**
 * `true` when a value of type `V` may be `null` or missing (an `unknown` may be). An `any` is not
 * counted: it is what a mistyped argument (already a compile error) turns into, and counting it would
 * add a second, misleading error further up.
 *
 * @typeParam V - The value type.
 * @example
 * ```ts
 * type A = CanBeNullish<number | null>; // true
 * type B = CanBeNullish<number>; // false
 * type C = CanBeNullish<any>; // false
 * ```
 */
type CanBeNullish<V> = 0 extends 1 & V
  ? false
  : [Extract<V, null | undefined>] extends [never]
    ? [unknown] extends [V]
      ? true
      : false
    : true;

/**
 * `R`, or `R | null` when any argument in `A` (a union of argument types) can be `null`/missing.
 *
 * @typeParam R - The result type for non-null arguments.
 * @typeParam A - The union of the argument types.
 * @example
 * ```ts
 * type A = PropagateNull<number, ExprNode<number>>; // number
 * type B = PropagateNull<number, ExprNode<number | undefined>>; // number | null
 * ```
 */
export type PropagateNull<R, A> = CanBeNullish<ArgValue<A>> extends true ? R | null : R;

/**
 * `undefined` replaced by `null`: a `$group` accumulator or key reports a missing value as `null`.
 *
 * @typeParam V - The value type.
 * @example
 * ```ts
 * type A = Nullify<string | undefined>; // string | null
 * ```
 */
export type Nullify<V> = undefined extends V ? Exclude<V, undefined> | null : V;

/**
 * The element type of every array type in `V` (`never` if there is none).
 *
 * @typeParam V - The value type.
 * @example
 * ```ts
 * type A = ElementOf<string[] | null>; // string
 * ```
 */
export type ElementOf<V> = V extends readonly (infer El)[] ? El : never;

/**
 * `true` when every non-null member of `V` is an array (the operator reads it as an array expression).
 *
 * @typeParam V - The value type.
 * @example
 * ```ts
 * type A = IsArrayValue<string[] | null>; // true
 * type B = IsArrayValue<string>; // false
 * ```
 */
export type IsArrayValue<V> = [Exclude<V, null | undefined>] extends [never]
  ? false
  : [Exclude<V, null | undefined>] extends [readonly unknown[]]
    ? true
    : false;

/**
 * The element type of the array argument `A`.
 *
 * @typeParam A - The argument type.
 * @example
 * ```ts
 * type A = ElementOfArg<ExprNode<number[]>>; // number
 * ```
 */
export type ElementOfArg<A> = ElementOf<Exclude<ArgValue<A>, null | undefined>>;

/**
 * Recursively unwraps nodes inside a value (an object or array literal with nodes inside). `readonly`
 * is removed at every level (a `const`-inferred `readonly` key would vanish from the next stage).
 * Opaque BSON values are leaves.
 *
 * @typeParam V - The value with nodes inside.
 * @example
 * ```ts
 * type A = UnwrapDeep<{ a: ExprNode<number>; b: readonly [ExprNode<string>] }>; // { a: number; b: [string] }
 * ```
 */
export type UnwrapDeep<V> =
  V extends ExprNode<infer R, never>
    ? R
    : V extends OpaqueValue | string | number | boolean | bigint | null | undefined
      ? V
      : V extends readonly unknown[]
        ? { -readonly [K in keyof V]: UnwrapDeep<V[K]> }
        : V extends object
          ? { -readonly [K in keyof V]: UnwrapDeep<V[K]> }
          : V;

/**
 * Flattens an intersection for readable hovers.
 *
 * @typeParam T - The type to flatten.
 * @example
 * ```ts
 * type A = Simplify<{ a: 1 } & { b: 2 }>; // { a: 1; b: 2 }
 * ```
 */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * `{ ...a, ...b }` at the type level (`B` overrides `A`), flattened.
 *
 * @typeParam A - The base object type.
 * @typeParam B - The overriding object type.
 * @example
 * ```ts
 * type A = Merge2<{ a: 1; b: 1 }, { b: 2 }>; // { a: 1; b: 2 }
 * ```
 */
export type Merge2<A, B> = Simplify<Omit<A, keyof B> & B>;

/**
 * What one `$mergeObjects` argument contributes: `null`/missing contributes nothing (keys become optional).
 *
 * @typeParam V - The argument value type.
 * @example
 * ```ts
 * type A = MergeArg<{ a: 1 } | null>; // { a?: 1 }
 * type B = MergeArg<{ a: 1 }>; // { a: 1 }
 * ```
 */
type MergeArg<V> = [Extract<V, null | undefined>] extends [never] ? V : Partial<Exclude<V, null | undefined>>;

/**
 * Left-to-right fold of `Merge2` over `$mergeObjects`'s arguments.
 *
 * @typeParam Args - The tuple of argument types.
 * @example
 * ```ts
 * type A = MergeObjectsResult<[{ a: 1; b: 1 }, { b: 2 }]>; // { a: 1; b: 2 }
 * ```
 */
export type MergeObjectsResult<Args extends readonly unknown[]> = Args extends readonly [infer Head, ...infer Tail]
  ? Tail extends readonly []
    ? Simplify<MergeArg<UnwrapDeep<Head>>>
    : Merge2<MergeArg<UnwrapDeep<Head>>, MergeObjectsResult<Tail>>
  : object;

/**
 * `$first` / `$last`: the element of an array expression (missing for `[]`), else the group value
 * (`undefined` → `null`).
 *
 * @typeParam V - The value type of the argument.
 * @example
 * ```ts
 * type A = PickResult<string[]>; // string | undefined
 * type B = PickResult<string | undefined>; // string | null
 * ```
 */
export type PickResult<V> =
  IsArrayValue<V> extends true ? PropagateNull<ElementOf<Exclude<V, null | undefined>> | undefined, V> : Nullify<V>;

/**
 * `$min` / `$max`: the element of an array expression (`null` for `[]`), else the group value
 * (`undefined` → `null`).
 *
 * @typeParam V - The value type of the argument.
 * @example
 * ```ts
 * type A = ExtremumResult<number[]>; // number | null
 * type B = ExtremumResult<number | undefined>; // number | null
 * ```
 */
export type ExtremumResult<V> =
  IsArrayValue<V> extends true ? ElementOf<Exclude<V, null | undefined>> | null : Nullify<V>;

/**
 * `$avg` / `$stdDevPop` / `$median`: `null` when there is nothing to average.
 *
 * @typeParam V - The value type of the argument.
 * @example
 * ```ts
 * type A = MeanResult<number[]>; // number | null
 * type B = MeanResult<number>; // number
 * ```
 */
export type MeanResult<V> = IsArrayValue<V> extends true ? number | null : PropagateNull<number, V>;

/**
 * What `$push`/`$addToSet` collect: missing values are skipped, `null` is kept.
 *
 * @typeParam V - The value type of the argument.
 * @example
 * ```ts
 * type A = Collected<string | null | undefined>; // string | null
 * ```
 */
export type Collected<V> = Exclude<V, undefined>;

/**
 * `true` when every argument type in the tuple can be `null`/missing.
 *
 * @typeParam Args - The tuple of argument types.
 * @example
 * ```ts
 * type A = AllNullable<[ExprNode<number | null>, ExprNode<string | undefined>]>; // true
 * type B = AllNullable<[ExprNode<number | null>, ExprNode<string>]>; // false
 * ```
 */
export type AllNullable<Args extends readonly unknown[]> = Args extends readonly [infer Head, ...infer Tail]
  ? PropagateNull<never, Head> extends never
    ? false
    : AllNullable<Tail>
  : true;

/**
 * `S` itself when it has no keys beyond `Shape`, otherwise `S` with every extra key typed `never`
 * (a generic constraint does not check excess properties).
 *
 * @typeParam S - The inferred object type.
 * @typeParam Shape - The allowed shape.
 * @example
 * ```ts
 * type A = Exact<{ a: 1 }, { a: number }>; // { a: 1 }
 * type B = Exact<{ a: 1; x: 2 }, { a: number }>; // { a: 1; x: 2 } & { x: never }
 * ```
 */
export type Exact<S, Shape> = S & { [K in Exclude<keyof S, keyof Shape>]: never };

/**
 * Union to intersection.
 *
 * @typeParam U - The union.
 * @example
 * ```ts
 * type A = UnionToIntersection<{ a: 1 } | { b: 2 }>; // { a: 1 } & { b: 2 }
 * ```
 */
export type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;
