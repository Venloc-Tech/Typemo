import { ConfigurationError } from "../../../errors/configuration-error.ts";
import { type AnyExprNode, ExprNodes } from "../expr-node.ts";
import type { Arg, ArgValue, ElementOfArg, Nullable, PropagateNull, UnwrapDeep } from "../expr-types.ts";
import { FieldProxies, type VarProxy } from "../field-proxy.ts";
import { type DualExpr, type Expr, OperatorFactory as F } from "../operator-factory.ts";
import { ScopeTracker } from "../scope-tracker.ts";
import { type SortDirectionInput, type SortSpecOf, SortSpecs } from "../sort-spec.ts";

/*
 * Array and set operators, and the scoped operators `$map` / `$filter` / `$reduce` (their callbacks
 * receive the element as a field proxy, so `item.price` drills down like `f.price`).
 */

/**
 * An array argument: an expression or a bare array, possibly `null`/missing.
 *
 * @example
 * ```ts
 * const a: ArrayArg = [1, 2, 3];
 * const b: ArrayArg = f.tags;
 * ```
 */
type ArrayArg = Arg<Nullable<readonly unknown[]>>;

/**
 * The value type of one `{ k, v }` / `[k, v]` pair.
 *
 * @typeParam P - The pair type.
 * @example
 * ```ts
 * type A = PairValue<{ k: string; v: number }>; // number
 * type B = PairValue<readonly [string, boolean]>; // boolean
 * ```
 */
type PairValue<P> = P extends { v: infer V } ? V : P extends readonly [string, infer V] ? V : never;

/**
 * `$concatArrays` / `$setUnion`: 2+ arrays as an expression; ONE argument is also an accumulator (MongoDB 8.1+).
 *
 * @example
 * ```ts
 * fn.concatArrays(f.a, f.b); // Expr<E[]>
 * fn.concatArrays(f.tags); // also usable as a `$group` accumulator
 * ```
 */
export interface ArrayUnionOp {
  /**
   * One array; also usable as an accumulator.
   *
   * @param single - The array (or, in a group, the per-document arrays are combined).
   * @returns The combined array.
   */
  <A extends ArrayArg>(single: A): DualExpr<ElementOfArg<A>[]>;
  /**
   * Two or more arrays.
   *
   * @param a - The first array.
   * @param b - The second array.
   * @param rest - More arrays.
   * @returns The combined array; `null` when an argument can be `null`.
   */
  <A extends ArrayArg, B extends ArrayArg, R extends readonly ArrayArg[]>(
    a: A,
    b: B,
    ...rest: R
  ): Expr<PropagateNull<(ElementOfArg<A> | ElementOfArg<B> | ElementOfArg<R[number]>)[], A | B | R[number]>>;
}

/**
 * Builds a `$concatArrays` / `$setUnion` operator.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The operator: one argument stays a single value, more are sent as a list.
 */
const arrayUnion = (op: string): ArrayUnionOp =>
  ((...args: readonly unknown[]): AnyExprNode =>
    F.node(op, args.length === 1 ? ExprNodes.serialize(args[0]) : args.map(ExprNodes.serialize))) as ArrayUnionOp;

/**
 * `sortBy` of `$sortArray`: a direction for scalars, `{ path: direction }` over the element's fields for
 * documents (H18: words too).
 *
 * @typeParam El - The element type of the array.
 * @example
 * ```ts
 * type A = ArraySortBy<number>; // SortDirectionInput
 * type B = ArraySortBy<{ price: number }>; // SortSpecOf<{ price: number }>
 * ```
 */
type ArraySortBy<El> = [NonNullable<El>] extends [object] ? SortSpecOf<NonNullable<El>> : SortDirectionInput;

/** Runtime of `$sortArray.sortBy`: words become `1`/`-1` (H18). */
class ArraySorts {
  /**
   * Normalizes the `sortBy` of `$sortArray`.
   *
   * @param sortBy - A direction, or an object of directions by field path.
   * @returns The `sortBy` with every direction as `1` or `-1`.
   * @throws {ConfigurationError} When a direction is invalid.
   */
  static sortBy(sortBy: unknown): unknown {
    if (typeof sortBy === "object" && sortBy !== null) {
      return SortSpecs.normalize(sortBy as Readonly<Record<string, unknown>>, "$sortArray.sortBy");
    }
    const direction = SortSpecs.directionOf(sortBy);
    if (direction === undefined)
      throw new ConfigurationError(`$sortArray.sortBy: invalid direction ${JSON.stringify(sortBy)}`);
    return direction;
  }
}

/** Array and set operators, and the scoped operators `$map`, `$filter` and `$reduce`. */
export const arrayOps = {
  /**
   * Number of elements (fails on a non-array).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/size/
   */
  size: F.unaryArray<readonly unknown[], number>("$size"),
  /**
   * The array reversed.
   *
   * @param array - The array.
   * @returns The reversed array; `null` when the array can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/reverseArray/
   */
  reverseArray: <A extends ArrayArg>(array: A): Expr<PropagateNull<ElementOfArg<A>[], A>> =>
    F.node("$reverseArray", ExprNodes.single(array)),
  /**
   * Concatenation; with one argument also an accumulator.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/concatArrays/
   */
  concatArrays: arrayUnion("$concatArrays"),
  /**
   * Set union; with one argument also an accumulator.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/setUnion/
   */
  setUnion: arrayUnion("$setUnion"),
  /**
   * Set intersection.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/setIntersection/
   */
  setIntersection: F.variadicArrays("$setIntersection"),
  /**
   * Elements of the first array missing from the second.
   *
   * @param a - The array to take elements from.
   * @param b - The array whose elements are removed.
   * @returns The difference; `null` when an argument can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/setDifference/
   */
  setDifference: <A extends ArrayArg, B extends ArrayArg>(a: A, b: B): Expr<PropagateNull<ElementOfArg<A>[], A | B>> =>
    F.node("$setDifference", [ExprNodes.serialize(a), ExprNodes.serialize(b)]),
  /**
   * Every element of the first array is in the second.
   *
   * @param a - The candidate subset.
   * @param b - The candidate superset.
   * @returns Whether `a` is a subset of `b`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/setIsSubset/
   */
  setIsSubset: (a: Arg<readonly unknown[]>, b: Arg<readonly unknown[]>): Expr<boolean> =>
    F.node("$setIsSubset", [ExprNodes.serialize(a), ExprNodes.serialize(b)]),
  /**
   * The arrays hold the same distinct elements.
   *
   * @param a - The first array.
   * @param b - The second array.
   * @param rest - More arrays.
   * @returns Whether all arrays hold the same distinct elements.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/setEquals/
   */
  setEquals: (
    a: Arg<readonly unknown[]>,
    b: Arg<readonly unknown[]>,
    ...rest: readonly Arg<readonly unknown[]>[]
  ): Expr<boolean> => F.node("$setEquals", [a, b, ...rest].map(ExprNodes.serialize)),
  /**
   * Index of a value, `-1` if absent.
   *
   * @param array - The array to search.
   * @param search - The value to look for.
   * @param start - The index to start from.
   * @param end - The index to stop before.
   * @returns The index; `null` when the array can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/indexOfArray/
   */
  indexOfArray: <A extends ArrayArg>(
    array: A,
    search: Arg<Nullable<ElementOfArg<A>>>,
    start?: Arg<number>,
    end?: Arg<number>,
  ): Expr<PropagateNull<number, A>> =>
    F.node("$indexOfArray", [array, search, start, end].filter((a) => a !== undefined).map(ExprNodes.serialize)),
  /**
   * Integers from `start` up to (not including) `end`.
   *
   * @param start - The first integer.
   * @param end - The bound, not included.
   * @param step - The increment.
   * @returns The integers.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/range/
   */
  range: (start: Arg<number>, end: Arg<number>, step?: Arg<number>): Expr<number[]> =>
    F.node("$range", [start, end, step].filter((a) => a !== undefined).map(ExprNodes.serialize)),
  /**
   * Transposes arrays.
   *
   * @param spec - The input arrays, whether to pad to the longest, and the padding defaults.
   * @returns The transposed arrays, `null` when an input can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/zip/
   */
  zip: (spec: {
    inputs: readonly ArrayArg[];
    useLongestLength?: boolean;
    defaults?: readonly Arg<unknown>[];
  }): Expr<unknown[][] | null> => F.node("$zip", ExprNodes.spec(spec)),
  /**
   * A slice: `(array, n)` or `(array, position, n)`.
   *
   * @param array - The array.
   * @param nOrPosition - `n` when alone, otherwise the position to start from.
   * @param n - The number of elements (with a position).
   * @returns The slice; `null` when the array can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/slice/
   */
  slice: <A extends ArrayArg>(
    array: A,
    nOrPosition: Arg<Nullable<number>>,
    n?: Arg<Nullable<number>>,
  ): Expr<PropagateNull<ElementOfArg<A>[], A>> =>
    F.node("$slice", [array, nOrPosition, n].filter((a) => a !== undefined).map(ExprNodes.serialize)),
  /**
   * Every element is truthy.
   *
   * @param array - The array.
   * @returns Whether every element is truthy.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/allElementsTrue/
   */
  allElementsTrue: (array: Arg<readonly unknown[]>): Expr<boolean> =>
    F.node("$allElementsTrue", [ExprNodes.serialize(array)]),
  /**
   * Some element is truthy.
   *
   * @param array - The array.
   * @returns Whether some element is truthy.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/anyElementTrue/
   */
  anyElementTrue: (array: Arg<readonly unknown[]>): Expr<boolean> =>
    F.node("$anyElementTrue", [ExprNodes.serialize(array)]),
  /**
   * Element at an index; out of range is missing (`undefined`).
   *
   * @param array - The array.
   * @param index - The index; negative counts from the end.
   * @returns The element, `undefined` when out of range, `null` when the array can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/arrayElemAt/
   */
  arrayElemAt: <A extends ArrayArg>(
    array: A,
    index: Arg<number>,
  ): Expr<PropagateNull<ElementOfArg<A> | undefined, A>> =>
    F.node("$arrayElemAt", [ExprNodes.serialize(array), ExprNodes.serialize(index)]),
  /**
   * Array of `{ k, v }` or `[k, v]` → document.
   *
   * @param array - The array of pairs.
   * @returns The document; `null` when the array can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/arrayToObject/
   */
  arrayToObject: <A extends Arg<Nullable<readonly ({ k: string; v: unknown } | readonly [string, unknown])[]>>>(
    array: A,
  ): Expr<PropagateNull<{ [key: string]: PairValue<ElementOfArg<A>> }, A>> =>
    F.node("$arrayToObject", ExprNodes.single(array)),
  /**
   * Sorts an array: `sortBy` is `1`/`-1` for scalars, or an object over the element's fields.
   *
   * @param spec - The array and the sort direction or spec.
   * @returns The sorted array; `null` when the array can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sortArray/
   */
  sortArray: <const A extends ArrayArg>(spec: {
    input: A;
    sortBy: ArraySortBy<ElementOfArg<A>>;
  }): Expr<PropagateNull<ElementOfArg<A>[], A>> =>
    F.node("$sortArray", {
      input: ExprNodes.serialize(spec.input),
      sortBy: ArraySorts.sortBy(spec.sortBy),
    }),

  /**
   * Applies `in` to every element; the element is a field proxy.
   *
   * @param spec - The array and the callback that builds the result for one element.
   * @returns The array of results; `null` when the array can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/map/
   */
  map: <const A extends ArrayArg, const R extends Arg<unknown>>(spec: {
    input: A;
    in: (item: VarProxy<ElementOfArg<A>>) => R;
  }): Expr<PropagateNull<UnwrapDeep<R>[], A>> =>
    ScopeTracker.build(
      "this",
      (depth) => `tmoEl${depth}`,
      (name, renamed) =>
        F.node("$map", {
          input: ExprNodes.serialize(spec.input),
          ...(renamed ? { as: name } : {}),
          in: ExprNodes.serialize(spec.in(FieldProxies.variable(name))),
        }),
    ),
  /**
   * Keeps the elements for which `cond` is true.
   *
   * @param spec - The array, the callback that builds the condition for one element, and an optional limit.
   * @returns The kept elements; `null` when the array can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/filter/
   */
  filter: <const A extends ArrayArg>(spec: {
    input: A;
    cond: (item: VarProxy<ElementOfArg<A>>) => Arg<Nullable<boolean>>;
    limit?: Arg<number>;
  }): Expr<PropagateNull<ElementOfArg<A>[], A>> =>
    ScopeTracker.build(
      "this",
      (depth) => `tmoEl${depth}`,
      (name, renamed) =>
        F.node("$filter", {
          input: ExprNodes.serialize(spec.input),
          ...(renamed ? { as: name } : {}),
          cond: ExprNodes.serialize(spec.cond(FieldProxies.variable(name))),
          ...(spec.limit === undefined ? {} : { limit: ExprNodes.serialize(spec.limit) }),
        }),
    ),
  /**
   * Folds an array; the result has the type of `initialValue`.
   *
   * @param spec - The array, the initial value and the callback that builds the next accumulator value.
   * @returns The folded value; `null` when the array can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/reduce/
   */
  reduce: <const A extends ArrayArg, V>(spec: {
    input: A;
    initialValue: Arg<V>;
    in: (value: VarProxy<V>, item: VarProxy<ElementOfArg<A>>) => Arg<V>;
  }): Expr<PropagateNull<V, A>> =>
    ScopeTracker.build(
      { value: "value", item: "this" },
      (depth) => ({ value: `tmoAcc${depth}`, item: `tmoEl${depth}` }),
      (names, renamed) => {
        const body = ExprNodes.serialize(
          spec.in(FieldProxies.variable<V>(names.value), FieldProxies.variable<ElementOfArg<A>>(names.item)),
        );
        return F.node("$reduce", {
          input: ExprNodes.serialize(spec.input),
          initialValue: ExprNodes.serialize(spec.initialValue),
          in: renamed ? { $let: { vars: { [names.value]: "$$value", [names.item]: "$$this" }, in: body } } : body,
        });
      },
    ),
};

/**
 * The value type a `$map` callback produces (for docs).
 *
 * @typeParam R - The type the callback returns.
 * @example
 * ```ts
 * type A = MapResult<ExprNode<number>>; // number
 * type B = MapResult<{ a: ExprNode<string> }>; // { a: string }
 * ```
 */
export type MapResult<R> = UnwrapDeep<ArgValue<R>>;
