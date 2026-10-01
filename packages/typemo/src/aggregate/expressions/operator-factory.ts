import { type ExprKind, type ExprNode, ExprNodes } from "./expr-node.ts";
import type { Arg, ElementOfArg, Nullable, PropagateNull } from "./expr-types.ts";

/*
 * Factories for the families of operators that share one signature shape, as one static class. Every factory
 * takes the MongoDB operator name and returns the typed operator. Arity and input types follow the server;
 * `PropagateNull` models `null`.
 */

/**
 * A plain expression (capability `"expr"` only).
 *
 * @typeParam V - The value type of the expression.
 * @example
 * ```ts
 * type E = Expr<number>; // ExprNode<number, "expr">: fits `$project`, not `$group` accumulator slots
 * ```
 */
export type Expr<V> = ExprNode<V>;

/**
 * Both an expression and an accumulator/window function (`$sum` with one argument, `$avg`, `$first`, …).
 *
 * @typeParam V - The value type of the expression.
 * @example
 * ```ts
 * type E = DualExpr<number>; // usable in `$project` and as a `$group` accumulator
 * ```
 */
export type DualExpr<V> = ExprNode<V, "expr" | "acc" | "window" | "bounded">;

/**
 * An accumulator that is also a bounded window function (`$push`, `$addToSet`, `$count`, `$top`, …).
 *
 * @typeParam V - The value type of the accumulator.
 * @example
 * ```ts
 * type A = AccExpr<string[]>; // fits `$group` and bounded `$setWindowFields`, not a plain expression slot
 * ```
 */
export type AccExpr<V> = ExprNode<V, "acc" | "window" | "bounded">;

/**
 * An accumulator of `$group`/`$bucket` only (`$accumulator`).
 *
 * @typeParam V - The value type of the accumulator.
 * @example
 * ```ts
 * type A = GroupAccExpr<number>; // fits `$group` only
 * ```
 */
export type GroupAccExpr<V> = ExprNode<V, "acc">;

/**
 * A window function that needs `sortBy` and takes no window (`$rank`, `$shift`, `$locf`, …).
 *
 * @typeParam V - The value type of the window function.
 * @example
 * ```ts
 * type W = SortedWindowExpr<number>; // `$setWindowFields` requires `sortBy` for it
 * ```
 */
export type SortedWindowExpr<V> = ExprNode<V, "window" | "needsSortBy">;

/**
 * A window function that needs a `sortBy` with exactly one field (`$rank`, `$denseRank`, `$documentNumber`,
 * `$linearFill`: a server rule).
 *
 * @typeParam V - The value type of the window function.
 * @example
 * ```ts
 * type W = SingleSortWindowExpr<number>; // `sortBy: { at: 1 }` compiles, `sortBy: { at: 1, _id: 1 }` does not
 * ```
 */
export type SingleSortWindowExpr<V> = ExprNode<V, "window" | "needsSortBy" | "singleSortKey">;

/**
 * A window function that needs `sortBy` and may take a window (`$derivative`, `$integral`).
 *
 * @typeParam V - The value type of the window function.
 * @example
 * ```ts
 * type W = SortedBoundedWindowExpr<number>; // needs `sortBy`, accepts `window`
 * ```
 */
export type SortedBoundedWindowExpr<V> = ExprNode<V, "window" | "bounded" | "needsSortBy">;

/**
 * A window function without a sort requirement that may take a window (`$covariancePop`, `$minMaxScaler`).
 *
 * @typeParam V - The value type of the window function.
 * @example
 * ```ts
 * type W = BoundedWindowExpr<number>; // accepts `window`, no `sortBy` needed
 * ```
 */
export type BoundedWindowExpr<V> = ExprNode<V, "window" | "bounded">;

/**
 * The node of an operator application `{ [op]: args }`.
 *
 * @typeParam V - The value type of the node.
 * @typeParam K - The capabilities of the node.
 * @param op - The MongoDB operator name, with the `$`.
 * @param args - The serialized operator arguments.
 * @returns The expression node.
 */
const node = <V, K extends ExprKind = "expr">(op: string, args: unknown): ExprNode<V, K> =>
  ExprNodes.make<V, K>({ [op]: args });

/** Factories of the operator families that share one signature shape. */
export class OperatorFactory {
  /** `{ [op]: args }` as a node; the only way the operator modules build nodes. */
  static readonly node = node;

  /**
   * Unary, passes `null` through: `Out | null` when the argument can be `null`/missing (`$abs`, `$toInt`).
   *
   * @typeParam In - The accepted argument type.
   * @typeParam Out - The result type for a non-null argument.
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator.
   */
  static unaryNull<In, Out>(op: string) {
    return <A extends Arg<Nullable<In>>>(x: A): Expr<PropagateNull<Out, A>> => node(op, ExprNodes.serialize(x));
  }

  /**
   * Unary, never `null` (`$toUpper` gives `""` for `null`, `$isNumber` gives `false`).
   *
   * @typeParam In - The accepted argument type.
   * @typeParam Out - The result type.
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator.
   */
  static unaryTo<In, Out>(op: string) {
    return (x: Arg<Nullable<In>>): Expr<Out> => node(op, ExprNodes.serialize(x));
  }

  /**
   * Unary whose argument may be an array literal (wrapped in one more array, or the server would read it as
   * a list of arguments) and must not be `null` (`$size`).
   *
   * @typeParam In - The accepted argument type.
   * @typeParam Out - The result type.
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator.
   */
  static unaryArray<In, Out>(op: string) {
    return (x: Arg<In>): Expr<Out> => node(op, ExprNodes.single(x));
  }

  /**
   * Variadic (1+) of one input type, never `null` (`$and`, `$or`: `null` counts as `false`).
   *
   * @typeParam In - The accepted argument type.
   * @typeParam Out - The result type.
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator.
   */
  static variadic1To<In, Out>(op: string) {
    return (a: Arg<Nullable<In>>, ...rest: readonly Arg<Nullable<In>>[]): Expr<Out> =>
      node(op, [a, ...rest].map(ExprNodes.serialize));
  }

  /**
   * Variadic (2+), passes `null` through (`$multiply`, `$concat`, `$bitAnd`).
   *
   * @typeParam In - The accepted argument type.
   * @typeParam Out - The result type for non-null arguments.
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator.
   */
  static variadicNull<In, Out>(op: string) {
    return <A extends Arg<Nullable<In>>, B extends Arg<Nullable<In>>, R extends readonly Arg<Nullable<In>>[]>(
      a: A,
      b: B,
      ...rest: R
    ): Expr<PropagateNull<Out, A | B | R[number]>> => node(op, [a, b, ...rest].map(ExprNodes.serialize));
  }

  /**
   * Exactly two arguments of one type, never `null` (`$strcasecmp`).
   *
   * @typeParam In - The accepted argument type.
   * @typeParam Out - The result type.
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator.
   */
  static binarySame<In, Out>(op: string) {
    return (a: Arg<Nullable<In>>, b: Arg<Nullable<In>>): Expr<Out> =>
      node(op, [ExprNodes.serialize(a), ExprNodes.serialize(b)]);
  }

  /**
   * Exactly two arguments, passes `null` through (`$divide`, `$mod`, `$pow`, `$log`, `$atan2`, `$split`).
   *
   * @typeParam In - The accepted argument type.
   * @typeParam Out - The result type for non-null arguments.
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator.
   */
  static binaryNull<In, Out>(op: string) {
    return <A extends Arg<Nullable<In>>, B extends Arg<Nullable<In>>>(a: A, b: B): Expr<PropagateNull<Out, A | B>> =>
      node(op, [ExprNodes.serialize(a), ExprNodes.serialize(b)]);
  }

  /**
   * Comparison: exactly two arguments of one shared type `V` (`fn.gt(f.price, "x")` fails: `"x"` is not
   * a number). `null` is always allowed on either side: `$eq: [x, null]` is the way to test for it.
   *
   * @typeParam Out - The result type.
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator; its type parameter `V` is the shared argument type.
   */
  static compare<Out>(op: string) {
    return <V>(a: Arg<Nullable<V>>, b: Arg<Nullable<V>>): Expr<Out> =>
      node(op, [ExprNodes.serialize(a), ExprNodes.serialize(b)]);
  }

  /**
   * 2+ arrays → array of their elements, `null` when an argument can be `null` (`$setIntersection`).
   *
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator.
   */
  static variadicArrays(op: string) {
    return <
      A extends Arg<Nullable<readonly unknown[]>>,
      B extends Arg<Nullable<readonly unknown[]>>,
      R extends readonly Arg<Nullable<readonly unknown[]>>[],
    >(
      a: A,
      b: B,
      ...rest: R
    ): Expr<PropagateNull<(ElementOfArg<A> | ElementOfArg<B> | ElementOfArg<R[number]>)[], A | B | R[number]>> =>
      node(op, [a, b, ...rest].map(ExprNodes.serialize));
  }

  /**
   * A nullary operator `{ [op]: {} }` of a given kind (`$rand`, `$rank`, `$count`).
   *
   * @typeParam V - The result type.
   * @typeParam K - The capabilities of the node.
   * @param op - The MongoDB operator name, with the `$`.
   * @returns The typed operator.
   */
  static nullary<V, K extends ExprKind = "expr">(op: string) {
    return (): ExprNode<V, K> => node<V, K>(op, {});
  }
}
