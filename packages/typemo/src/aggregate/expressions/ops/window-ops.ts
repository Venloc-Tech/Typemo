import { ConfigurationError } from "../../../errors/configuration-error.ts";
import { type ExprKind, type ExprNode, ExprNodes } from "../expr-node.ts";
import type { Arg, Nullable, Nullify, UnwrapDeep } from "../expr-types.ts";
import {
  type BoundedWindowExpr,
  OperatorFactory as F,
  type SingleSortWindowExpr,
  type SortedWindowExpr,
} from "../operator-factory.ts";
import type { DateUnit } from "./date-ops.ts";

/*
 * Window functions: only valid in `$setWindowFields.output` (kind `"window"`). Those that need an order carry
 * `"needsSortBy"`: `$setWindowFields` without `sortBy` rejects them at compile time (the server rejects them at
 * run time). `withWindow` attaches a `window` to an accumulator.
 */

/**
 * A window bound: a document offset / range value, or `"current"` / `"unbounded"`.
 *
 * @example
 * ```ts
 * const bounds: WindowBound[] = [-1, 0, "current", "unbounded"];
 * ```
 */
export type WindowBound = number | "current" | "unbounded";

/**
 * `window` of a `$setWindowFields` output: by document position, or by a range of the `sortBy` value.
 *
 * @example
 * ```ts
 * const byPosition: WindowSpec = { documents: ["unbounded", "current"] };
 * const byRange: WindowSpec = { range: [-7, "current"], unit: "day" };
 * ```
 */
export type WindowSpec =
  | { readonly documents: readonly [WindowBound, WindowBound] }
  | { readonly range: readonly [WindowBound, WindowBound]; readonly unit?: DateUnit };

/**
 * `true` when a window needs `sortBy`: every `range` window, and a `documents` window with a bound
 * other than `"unbounded"` (checked on the server, test `aggregate/window-rules`).
 *
 * @typeParam W - The window spec type.
 * @example
 * ```ts
 * type A = WindowNeedsSort<{ documents: ["unbounded", "unbounded"] }>; // false
 * type B = WindowNeedsSort<{ documents: ["unbounded", "current"] }>; // true
 * ```
 */
type WindowNeedsSort<W> = W extends { readonly documents: readonly ["unbounded", "unbounded"] } ? false : true;

/**
 * The kind of a node once a window is attached: a window function only (not an accumulator of `$group` any more).
 *
 * @typeParam K - The capabilities before the window is attached.
 * @typeParam W - The window spec type.
 * @example
 * ```ts
 * type A = WindowedKind<"acc" | "window" | "bounded", { documents: ["unbounded", "current"] }>;
 * // "window" | "needsSortBy"
 * ```
 */
type WindowedKind<K extends ExprKind, W> =
  | "window"
  | ("needsSortBy" extends K ? "needsSortBy" : never)
  | (WindowNeedsSort<W> extends true ? "needsSortBy" : never);

/**
 * A window function that takes effect only with a window (`$derivative`, `$integral`): `withWindow` makes it
 * an output.
 *
 * @typeParam V - The value type of the function.
 * @example
 * ```ts
 * type P = WindowPendingExpr<number | null>; // not a window output until `withWindow` is applied
 * ```
 */
type WindowPendingExpr<V> = ExprNode<V, "bounded" | "needsSortBy">;

/**
 * A number or a date argument: an expression or a bare value, possibly `null`/missing.
 *
 * @example
 * ```ts
 * const a: NumberOrDate = f.price;
 * const b: NumberOrDate = f.createdAt;
 * ```
 */
type NumberOrDate = Arg<Nullable<number | bigint | Date>>;

/** Window functions. */
export const windowOps = {
  /**
   * Rank with gaps after ties (needs a `sortBy` with one field).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/rank/
   */
  rank: F.nullary<number, "window" | "needsSortBy" | "singleSortKey">("$rank"),
  /**
   * Rank without gaps (needs a `sortBy` with one field).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/denseRank/
   */
  denseRank: F.nullary<number, "window" | "needsSortBy" | "singleSortKey">("$denseRank"),
  /**
   * 1-based position in the partition (needs a `sortBy` with one field).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/documentNumber/
   */
  documentNumber: F.nullary<number, "window" | "needsSortBy" | "singleSortKey">("$documentNumber"),
  /**
   * `output` of the document `by` positions away (needs `sortBy`); `default` (a constant) when there is
   * none, else `null`.
   *
   * @param spec - The output expression, the offset and the optional default.
   * @returns The shifted value.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/shift/
   */
  shift: <const A extends Arg<unknown>, const D = never>(spec: {
    output: A;
    by: number;
    default?: D;
  }): SortedWindowExpr<Nullify<UnwrapDeep<A>> | ([D] extends [never] ? null : D)> =>
    F.node("$shift", {
      output: ExprNodes.serialize(spec.output),
      by: spec.by,
      ...(spec.default === undefined ? {} : { default: ExprNodes.serialize(spec.default) }),
    }),
  /**
   * Average rate of change (needs `sortBy` AND an explicit window: the server rejects it without one, so the
   * bare node is not a window output until `withWindow`; `unit` for dates).
   *
   * @param spec - The input and, for dates, the time unit.
   * @returns The rate of change; `null` when it cannot be computed.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/derivative/
   */
  derivative: (spec: { input: NumberOrDate; unit?: DateUnit }): WindowPendingExpr<number | null> =>
    F.node("$derivative", ExprNodes.spec(spec)),
  /**
   * Area under the curve (needs `sortBy` and an explicit window, like `$derivative`).
   *
   * @param spec - The input and, for dates, the time unit.
   * @returns The area; `null` when it cannot be computed.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/integral/
   */
  integral: (spec: { input: NumberOrDate; unit?: DateUnit }): WindowPendingExpr<number | null> =>
    F.node("$integral", ExprNodes.spec(spec)),
  /**
   * Exponential moving average with `N` periods or an `alpha` decay (needs `sortBy`).
   *
   * @param spec - The input and either `N` or `alpha`.
   * @returns The moving average; `null` when the input is not numeric.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/expMovingAvg/
   */
  expMovingAvg: (
    spec: { input: Arg<Nullable<number>> } & ({ N: number; alpha?: never } | { alpha: number; N?: never }),
  ): SortedWindowExpr<number | null> => F.node("$expMovingAvg", ExprNodes.spec(spec)),
  /**
   * Population covariance.
   *
   * @param a - The first variable.
   * @param b - The second variable.
   * @returns The covariance; `null` when it cannot be computed.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/covariancePop/
   */
  covariancePop: (a: Arg<Nullable<number>>, b: Arg<Nullable<number>>): BoundedWindowExpr<number | null> =>
    F.node("$covariancePop", [ExprNodes.serialize(a), ExprNodes.serialize(b)]),
  /**
   * Sample covariance.
   *
   * @param a - The first variable.
   * @param b - The second variable.
   * @returns The covariance; `null` when it cannot be computed.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/covarianceSamp/
   */
  covarianceSamp: (a: Arg<Nullable<number>>, b: Arg<Nullable<number>>): BoundedWindowExpr<number | null> =>
    F.node("$covarianceSamp", [ExprNodes.serialize(a), ExprNodes.serialize(b)]),
  /**
   * Linear interpolation of missing values (needs a `sortBy` with one field).
   *
   * @param value - The value to fill.
   * @returns The value with gaps filled.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/linearFill/
   */
  linearFill: <const A extends Arg<Nullable<number | Date>>>(value: A): SingleSortWindowExpr<Nullify<UnwrapDeep<A>>> =>
    F.node("$linearFill", ExprNodes.serialize(value)),
  /**
   * Last observation carried forward (the server does not require `sortBy`, checked).
   *
   * @param value - The value to fill.
   * @returns The value with gaps filled.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/locf/
   */
  locf: <const A extends Arg<unknown>>(value: A): ExprNode<Nullify<UnwrapDeep<A>>, "window"> =>
    F.node("$locf", ExprNodes.serialize(value)),
  /**
   * Scales into `[min, max]` (default `[0, 1]`) by the window's minimum and maximum (MongoDB 8.2+).
   *
   * @param spec - The input and the optional target range.
   * @returns The scaled value.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/minMaxScaler/
   */
  minMaxScaler: (spec: { input: Arg<number>; min?: number; max?: number }): BoundedWindowExpr<number> =>
    F.node("$minMaxScaler", ExprNodes.spec(spec)),
};

/**
 * Attaches a `window` to an accumulator used as a window function: `withWindow(fn.sum(f.total),
 * { documents: ["unbounded", "current"] })`. Only a node with the `"bounded"` capability takes a window
 * (not `$rank`, `$shift`, …); the result is a window function only, and needs `sortBy` unless the window
 * is `["unbounded", "unbounded"]` documents.
 *
 * @typeParam V - The value type of the accumulator.
 * @typeParam K - The capabilities of the accumulator.
 * @typeParam W - The window spec type.
 * @param expr - The accumulator to attach the window to.
 * @param window - The window.
 * @returns A window function with the same serialized operator plus `window`.
 * @throws {ConfigurationError} When the expression is not an operator object.
 * @example
 * ```ts
 * withWindow(fn.sum(f.total), { documents: ["unbounded", "current"] }); // running total
 * ```
 */
export const withWindow = <V, K extends ExprKind, const W extends WindowSpec>(
  expr: ExprNode<V, K> &
    ("bounded" extends K
      ? unknown
      : { readonly error: "withWindow takes an accumulator that accepts a window (fn.sum, fn.avg, fn.push, ...)" }),
  window: W,
): ExprNode<V, WindowedKind<K, W>> => {
  const serialized = ExprNodes.unwrap(expr);
  if (typeof serialized !== "object" || serialized === null || Array.isArray(serialized)) {
    throw new ConfigurationError("withWindow takes an accumulator expression such as fn.sum(f.x)");
  }
  return ExprNodes.make<V, WindowedKind<K, W>>({ ...serialized, window });
};
