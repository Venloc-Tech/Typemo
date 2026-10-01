import { type ExprNode, ExprNodes } from "../expr-node.ts";
import type { Arg, Nullable, UnwrapDeep } from "../expr-types.ts";
import { type Expr, OperatorFactory as F } from "../operator-factory.ts";

/*
 * Boolean, comparison and conditional operators. Comparisons take one shared type on both sides:
 * the server compares across types by BSON order, which is never what a typed query means.
 */

/**
 * A `$switch` branch.
 *
 * @typeParam C - The type of the condition.
 * @typeParam T - The type of the result.
 * @example
 * ```ts
 * const branch: SwitchBranch<Expr<boolean>, string> = { case: fn.gt(f.age, 18), then: "adult" };
 * ```
 */
export interface SwitchBranch<C, T> {
  /** The condition. */
  case: C;
  /** The result when the condition is true. */
  then: T;
}

/**
 * An expression position that takes any value: a node usable as an expression, or a bare value.
 *
 * @example
 * ```ts
 * const a: AnyArg = "text";
 * const b: AnyArg = f.price;
 * ```
 */
type AnyArg = Arg<unknown>;

/** Boolean, comparison and conditional operators. */
export const logicOps = {
  /**
   * All true (1+ arguments; `null` counts as false).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/and/
   */
  and: F.variadic1To<boolean, boolean>("$and"),
  /**
   * Any true (1+ arguments; `null` counts as false).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/or/
   */
  or: F.variadic1To<boolean, boolean>("$or"),
  /**
   * Negation.
   *
   * @param x - The boolean to negate.
   * @returns The negation.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/not/
   */
  not: (x: Arg<Nullable<boolean>>): Expr<boolean> => F.node("$not", [ExprNodes.serialize(x)]),
  /**
   * Three-way comparison: `-1`, `0`, `1`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/cmp/
   */
  cmp: F.compare<-1 | 0 | 1>("$cmp"),
  /**
   * Equality.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/eq/
   */
  eq: F.compare<boolean>("$eq"),
  /**
   * Inequality.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/ne/
   */
  ne: F.compare<boolean>("$ne"),
  /**
   * Greater than.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/gt/
   */
  gt: F.compare<boolean>("$gt"),
  /**
   * Greater than or equal.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/gte/
   */
  gte: F.compare<boolean>("$gte"),
  /**
   * Less than.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/lt/
   */
  lt: F.compare<boolean>("$lt"),
  /**
   * Less than or equal.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/lte/
   */
  lte: F.compare<boolean>("$lte"),
  /**
   * `value` is an element of `array` (the array must not be `null`).
   *
   * @param value - The value to look for.
   * @param array - The array to look in.
   * @returns Whether the array contains the value.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/in/
   */
  isIn: <V>(value: Arg<Nullable<V>>, array: Arg<readonly V[]>): Expr<boolean> =>
    F.node("$in", [ExprNodes.serialize(value), ExprNodes.serialize(array)]),
  /**
   * `then` when `if` is true, else `else`.
   *
   * @param condition - The condition.
   * @param then - The result when the condition is true.
   * @param otherwise - The result otherwise.
   * @returns The chosen result; its type is the union of both branches.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/cond/
   */
  cond: <const T extends AnyArg, const E extends AnyArg>(
    condition: Arg<Nullable<boolean>>,
    then: T,
    otherwise: E,
  ): Expr<UnwrapDeep<T> | UnwrapDeep<E>> =>
    F.node("$cond", [ExprNodes.serialize(condition), ExprNodes.serialize(then), ExprNodes.serialize(otherwise)]),
  /**
   * First branch whose `case` is true; `default` otherwise (without `default` and no match the server
   * fails, so the type does not add `null`).
   *
   * @param spec - The branches and the optional default.
   * @returns The result of the chosen branch.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/switch/
   */
  switch: <
    const B extends readonly SwitchBranch<Arg<Nullable<boolean>>, AnyArg>[],
    const D extends AnyArg = never,
  >(spec: {
    branches: B;
    default?: D;
  }): Expr<UnwrapDeep<B[number]["then"]> | UnwrapDeep<D>> =>
    F.node("$switch", {
      // biome-ignore lint/suspicious/noThenProperty: `then` is the key of a MongoDB $switch branch
      branches: spec.branches.map((b) => ({ case: ExprNodes.serialize(b.case), then: ExprNodes.serialize(b.then) })),
      ...(spec.default === undefined ? {} : { default: ExprNodes.serialize(spec.default) }),
    }),
  /**
   * The first argument that is not `null`/missing; the last one is the fallback.
   *
   * @param value - The value to test.
   * @param fallback - The result when `value` is `null` or missing.
   * @param more - More fallbacks, tried in order.
   * @returns The first non-null argument.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/ifNull/
   */
  ifNull: <V>(value: Arg<Nullable<V>>, fallback: Arg<V>, ...more: readonly Arg<V>[]): Expr<V> =>
    F.node("$ifNull", [value, fallback, ...more].map(ExprNodes.serialize)),
  /**
   * A value passed verbatim, never read as a path or operator.
   *
   * @param value - The literal.
   * @returns The literal as an expression.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/literal/
   */
  literal: <const V>(value: V): Expr<V> => F.node("$literal", value),
};

/**
 * A node of a boolean-ish value (for docs and stage signatures).
 *
 * @example
 * ```ts
 * const node: BooleanNode = fn.gt(f.age, 18);
 * ```
 */
export type BooleanNode = ExprNode<boolean>;
