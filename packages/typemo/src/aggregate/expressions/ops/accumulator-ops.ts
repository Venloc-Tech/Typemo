import type { PathError } from "../../types/path-types.ts";
import { type AnyExprNode, ExprNodes } from "../expr-node.ts";
import type {
  AllNullable,
  Arg,
  ArgValue,
  Collected,
  ElementOf,
  ExtremumResult,
  IsArrayValue,
  MeanResult,
  Nullable,
  Nullify,
  PickResult,
  UnwrapDeep,
} from "../expr-types.ts";
import {
  type AccExpr,
  type DualExpr,
  type Expr,
  OperatorFactory as F,
  type GroupAccExpr,
} from "../operator-factory.ts";
import { type SortKeys, SortSpecs } from "../sort-spec.ts";
import type { Numeric, NumericResult } from "./arithmetic-ops.ts";

/*
 * Accumulators (`$group`, `$bucket(Auto).output`, `$setWindowFields.output`). An operator that is also
 * an expression (`$sum` of one argument over an array, `$first` of an array, …) is a `DualExpr`; the
 * multi-argument expression forms (`$sum: [a, b]`) are plain expressions. Result rules:
 * `$sum`/`$count` are never `null`; `$avg`/`$stdDev*`/`$median` are `null` for nothing to average;
 * `$first`/`$last`/`$min`/`$max` report a missing value as `null` in a group.
 */

/**
 * The argument of a single-argument numeric accumulator: a number, or an array of numbers.
 *
 * @example
 * ```ts
 * const a: NumArg = f.price;
 * const b: NumArg = f.prices; // an array of numbers, as an expression
 * ```
 */
type NumArg = Arg<Nullable<Numeric | readonly Nullable<Numeric>[]>>;

/**
 * One numeric argument of a multi-argument numeric operator.
 *
 * @example
 * ```ts
 * const a: NumArg1 = 1;
 * const b: NumArg1 = f.price;
 * ```
 */
type NumArg1 = Arg<Nullable<Numeric>>;

/**
 * The type of a sum: the widest numeric type of the inputs (`NumericResult`), and `number` when an input
 * may be missing or `null` (missing and non-numeric values count as the int32 `0`).
 *
 * @typeParam V - The value type of the argument (an element type, or an array of it).
 * @example
 * ```ts
 * type A = SumResult<number>; // number
 * type B = SumResult<bigint | null>; // bigint | number
 * ```
 */
type SumResult<V> =
  | NumericResult<Exclude<V extends readonly (infer E)[] ? E : V, null | undefined>>
  | ([Extract<V extends readonly (infer E)[] ? E : V, null | undefined>] extends [never] ? never : number);

/**
 * `$sum`: one argument (accumulator or array expression), or 2+ (expression). Missing counts as 0.
 *
 * @example
 * ```ts
 * fn.sum(f.price); // DualExpr<number>: an accumulator and an expression over an array
 * fn.sum(f.a, f.b); // Expr<number>
 * ```
 */
export interface SumOp {
  /**
   * One argument: a `$group` accumulator, or the sum of an array expression.
   *
   * @param x - The number or array of numbers.
   * @returns The sum.
   */
  <A extends NumArg>(x: A): DualExpr<SumResult<ArgValue<A>>>;
  /**
   * Two or more numbers.
   *
   * @param args - The numbers.
   * @returns The sum.
   */
  <const Args extends readonly [NumArg1, NumArg1, ...NumArg1[]]>(
    ...args: Args
  ): Expr<SumResult<ArgValue<Args[number]>>>;
}

/**
 * `$avg` / `$stdDevPop`: one argument (accumulator or array), or 2+ (expression).
 *
 * @example
 * ```ts
 * fn.avg(f.price); // DualExpr<number | null>
 * fn.avg(f.a, f.b); // Expr<number>
 * ```
 */
export interface MeanOp {
  /**
   * One argument: a `$group` accumulator, or the mean of an array expression.
   *
   * @param x - The number or array of numbers.
   * @returns The mean; `null` when there is nothing to average.
   */
  <A extends NumArg>(x: A): DualExpr<MeanResult<ArgValue<A>>>;
  /**
   * Two or more numbers.
   *
   * @param args - The numbers.
   * @returns The mean; `null` only when every argument can be `null`.
   */
  <const Args extends readonly [NumArg1, NumArg1, ...NumArg1[]]>(
    ...args: Args
  ): Expr<number | (AllNullable<Args> extends true ? null : never)>;
}

/**
 * `$min` / `$max`: one argument (accumulator or array), or 2+ compared with each other.
 *
 * @example
 * ```ts
 * fn.max(f.price); // DualExpr<number | null>
 * fn.max(f.a, f.b); // Expr<number>
 * ```
 */
export interface ExtremumOp {
  /**
   * One argument: a `$group` accumulator, or the extremum of an array expression.
   *
   * @param x - The value or array.
   * @returns The extremum; `null` for an empty array or a missing value.
   */
  <A extends Arg<unknown>>(x: A): DualExpr<ExtremumResult<UnwrapDeep<A>>>;
  /**
   * Two or more values compared with each other.
   *
   * @param args - The values.
   * @returns The extremum; `null` only when every argument can be `null`.
   */
  <const Args extends readonly [Arg<unknown>, Arg<unknown>, ...Arg<unknown>[]]>(
    ...args: Args
  ): Expr<Exclude<ArgValue<Args[number]>, null | undefined> | (AllNullable<Args> extends true ? null : never)>;
}

/**
 * Builds an operator whose one argument stays a single value and more are sent as a list.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The untyped operator function.
 */
const oneOrMany =
  (op: string) =>
  (...args: readonly unknown[]): AnyExprNode =>
    F.node(op, args.length === 1 ? ExprNodes.serialize(args[0]) : args.map(ExprNodes.serialize));

/**
 * What `$firstN`/`$lastN` collect: the elements of an array expression, or the per-document values
 * (missing → `null`).
 *
 * @typeParam V - The value type of the input.
 * @example
 * ```ts
 * type A = NthResult<string[]>; // string
 * type B = NthResult<string | undefined>; // string | null
 * ```
 */
type NthResult<V> = IsArrayValue<V> extends true ? ElementOf<Exclude<V, null | undefined>> : Nullify<V>;

/**
 * What `$minN`/`$maxN` collect: `null` and missing values are skipped.
 *
 * @typeParam V - The value type of the input.
 * @example
 * ```ts
 * type A = RankedResult<number[]>; // number
 * type B = RankedResult<number | null | undefined>; // number
 * ```
 */
type RankedResult<V> =
  IsArrayValue<V> extends true ? ElementOf<Exclude<V, null | undefined>> : Exclude<V, null | undefined>;

/**
 * Builds a `$firstN` / `$lastN` / `$minN` / `$maxN` operator.
 *
 * @typeParam R - Which result rule applies: `"nth"` or `"ranked"`.
 * @param op - The MongoDB operator name, with the `$`.
 * @param _result - Selects the result type only; unused at run time.
 * @returns The typed operator taking `{ input, n }`.
 */
const nSpec =
  <R extends "nth" | "ranked">(op: string, _result: R) =>
  <const A extends Arg<unknown>>(spec: {
    input: A;
    n: Arg<number>;
  }): DualExpr<(R extends "nth" ? NthResult<UnwrapDeep<A>> : RankedResult<UnwrapDeep<A>>)[]> =>
    F.node(op, { input: ExprNodes.serialize(spec.input), n: ExprNodes.serialize(spec.n) });

/**
 * Builds a `$top` / `$bottom` operator.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator taking `{ output, sortBy }`.
 */
const sorted =
  (op: string) =>
  <const A extends Arg<unknown>>(spec: { output: A; sortBy: SortKeys }): AccExpr<Nullify<UnwrapDeep<A>>> =>
    F.node(op, { output: ExprNodes.serialize(spec.output), sortBy: SortSpecs.fromKeys(spec.sortBy) });

/**
 * Builds a `$topN` / `$bottomN` operator.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator taking `{ output, sortBy, n }`.
 */
const sortedN =
  (op: string) =>
  <const A extends Arg<unknown>>(spec: {
    output: A;
    sortBy: SortKeys;
    n: Arg<number>;
  }): AccExpr<Nullify<UnwrapDeep<A>>[]> =>
    F.node(op, {
      output: ExprNodes.serialize(spec.output),
      sortBy: SortSpecs.fromKeys(spec.sortBy),
      n: ExprNodes.serialize(spec.n),
    });

/**
 * A percentile fraction literal in `[0, 1]`; a non-literal number cannot be checked and is accepted.
 *
 * @typeParam N - The number type.
 * @example
 * ```ts
 * type A = Fraction<0.5>; // 0.5
 * type B = Fraction<1.5>; // never
 * type C = Fraction<number>; // number
 * ```
 */
type Fraction<N extends number> = number extends N ? N : `${N}` extends "0" | "1" | `0.${number}` ? N : never;

/**
 * Server-side JavaScript: a function source; arrow functions are wrapped (the server returns their source
 * otherwise).
 *
 * @param body - The function source, or a function whose source is taken.
 * @returns The source text to send to the server.
 */
const functionSource = (body: string | ((...args: never[]) => unknown)): string =>
  typeof body === "string" ? body : `function () { return (${body.toString()}).apply(this, arguments); }`;

/**
 * A server-side JavaScript function: its source text, or a function whose source is sent.
 *
 * @example
 * ```ts
 * const a: JsFunction = "function () { return 0; }";
 * const b: JsFunction = () => 0;
 * ```
 */
type JsFunction = string | ((...args: never[]) => unknown);

/**
 * What `$accumulator` takes on the server. Typemo never sends it (server-side JavaScript is refused), so
 * `fn.accumulator` does not accept it in the types; the object is still built for JavaScript callers, and the core
 * refuses the pipeline before it reaches the server.
 *
 * @example
 * ```ts
 * const spec: JsAccumulatorSpec = { init: () => 0, accumulate: (n: number) => n + 1, accumulateArgs: [], merge: (a: number, b: number) => a + b };
 * ```
 */
interface JsAccumulatorSpec {
  /** The initial state. */
  readonly init: JsFunction;
  /** Adds one document to the state. */
  readonly accumulate: JsFunction;
  /** The arguments of `accumulate`. */
  readonly accumulateArgs: readonly Arg<unknown>[];
  /** Merges two states. */
  readonly merge: JsFunction;
  /** The arguments of `init`. */
  readonly initArgs?: readonly Arg<unknown>[];
  /** The final result from the state. */
  readonly finalize?: JsFunction;
}

/**
 * What `$function` takes on the server (see {@link JsAccumulatorSpec}: never sent by Typemo).
 *
 * @example
 * ```ts
 * const spec: JsFunctionSpec = { body: (n: number) => n + 1, args: [] };
 * ```
 */
interface JsFunctionSpec {
  /** The function. */
  readonly body: JsFunction;
  /** Its arguments. */
  readonly args: readonly Arg<unknown>[];
}

/**
 * The compile error of `fn.accumulator`: server-side JavaScript is not supported; the `$group` accumulators do the
 * same work.
 *
 * @example
 * ```ts
 * type E = AccumulatorRefused["error"];
 * ```
 */
type AccumulatorRefused =
  PathError<"fn.accumulator: server-side JavaScript ($accumulator) is not supported: it runs with the rights of the database and cannot be checked against the schema; use the $group accumulators instead (fn.sum, fn.avg, fn.push, fn.addToSet, fn.top, fn.firstN, fn.mergeObjects, ...)">;

/**
 * The compile error of `fn.function`: server-side JavaScript is not supported; the expression operators do the same
 * work.
 *
 * @example
 * ```ts
 * type E = FunctionRefused["error"];
 * ```
 */
type FunctionRefused =
  PathError<"fn.function: server-side JavaScript ($function) is not supported: it runs with the rights of the database and cannot be checked against the schema; use the $expr operators instead (fn.cond, fn.switch, fn.map, fn.filter, fn.reduce, fn.let, ...)">;

/** Accumulator operators, usable in `$group`, `$bucket`, `$bucketAuto` and `$setWindowFields`. */
export const accumulatorOps = {
  /**
   * Sum (never `null`).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sum/
   */
  sum: oneOrMany("$sum") as SumOp,
  /**
   * Average (`null` when nothing to average).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/avg/
   */
  avg: oneOrMany("$avg") as MeanOp,
  /**
   * Minimum.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/min/
   */
  min: oneOrMany("$min") as ExtremumOp,
  /**
   * Maximum.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/max/
   */
  max: oneOrMany("$max") as ExtremumOp,
  /**
   * Population standard deviation.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/stdDevPop/
   */
  stdDevPop: oneOrMany("$stdDevPop") as MeanOp,
  /**
   * Sample standard deviation (`null` for a single value).
   *
   * @param x - The number or array of numbers.
   * @returns The sample standard deviation.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/stdDevSamp/
   */
  stdDevSamp: (x: NumArg): DualExpr<number | null> => F.node("$stdDevSamp", ExprNodes.serialize(x)),
  /**
   * First value of a group / first element of an array.
   *
   * @param x - The value or array.
   * @returns The first value; a missing value is `null` in a group.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/first/
   */
  first: <const A extends Arg<unknown>>(x: A): DualExpr<PickResult<UnwrapDeep<A>>> =>
    F.node("$first", ExprNodes.serialize(x)),
  /**
   * Last value of a group / last element of an array.
   *
   * @param x - The value or array.
   * @returns The last value; a missing value is `null` in a group.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/last/
   */
  last: <const A extends Arg<unknown>>(x: A): DualExpr<PickResult<UnwrapDeep<A>>> =>
    F.node("$last", ExprNodes.serialize(x)),
  /**
   * Collects values (missing skipped, `null` kept).
   *
   * @param x - The value to collect from every document.
   * @returns The array of collected values.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/push/
   */
  push: <const A extends Arg<unknown>>(x: A): AccExpr<Collected<UnwrapDeep<A>>[]> =>
    F.node("$push", ExprNodes.serialize(x)),
  /**
   * Collects distinct values.
   *
   * @param x - The value to collect from every document.
   * @returns The array of distinct values.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/addToSet/
   */
  addToSet: <const A extends Arg<unknown>>(x: A): AccExpr<Collected<UnwrapDeep<A>>[]> =>
    F.node("$addToSet", ExprNodes.serialize(x)),
  /**
   * Number of documents (`{ $count: {} }`).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/count-accumulator/
   */
  count: F.nullary<number, "acc" | "window" | "bounded">("$count"),
  /**
   * First `n` values / elements.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/firstN/
   */
  firstN: nSpec("$firstN", "nth"),
  /**
   * Last `n` values / elements.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/lastN/
   */
  lastN: nSpec("$lastN", "nth"),
  /**
   * Largest `n` values (null/missing skipped).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/maxN/
   */
  maxN: nSpec("$maxN", "ranked"),
  /**
   * Smallest `n` values (null/missing skipped).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/minN/
   */
  minN: nSpec("$minN", "ranked"),
  /**
   * `output` of the first document by `sortBy` (`[[f.score, -1]]`).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/top/
   */
  top: sorted("$top"),
  /**
   * `output` of the last document by `sortBy`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/bottom/
   */
  bottom: sorted("$bottom"),
  /**
   * `output` of the first `n` documents by `sortBy`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/topN/
   */
  topN: sortedN("$topN"),
  /**
   * `output` of the last `n` documents by `sortBy`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/bottomN/
   */
  bottomN: sortedN("$bottomN"),
  /**
   * Approximate median.
   *
   * @param spec - The input and the method.
   * @returns The median; `null` when there is nothing to compute it from.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/median/
   */
  median: <A extends NumArg>(spec: { input: A; method?: "approximate" }): DualExpr<MeanResult<ArgValue<A>>> =>
    F.node("$median", { input: ExprNodes.serialize(spec.input), method: spec.method ?? "approximate" }),
  /**
   * Approximate percentiles (`p` literals in `[0, 1]`).
   *
   * @param spec - The input, the fractions and the method.
   * @returns One value per fraction.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/percentile/
   */
  percentile: <A extends NumArg, const P extends readonly number[]>(spec: {
    input: A;
    p: P & { readonly [I in keyof P]: Fraction<P[I]> };
    method?: "approximate";
  }): DualExpr<MeanResult<ArgValue<A>>[]> =>
    F.node("$percentile", {
      input: ExprNodes.serialize(spec.input),
      p: ExprNodes.serialize(spec.p),
      method: spec.method ?? "approximate",
    }),
  /**
   * `$accumulator` (a `$group` accumulator in server-side JavaScript) is NOT supported: any call is a compile error
   * whose text says so and names the `$group` accumulators to use instead. A JavaScript caller still gets the
   * stage built, and the core refuses it before it is sent (`StrictModeError`, rule `sanitize`).
   *
   * @param spec - Not accepted: the parameter type is the compile error.
   * @returns Nothing usable: the pipeline is refused.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/accumulator/
   */
  accumulator: <V = never>(spec: AccumulatorRefused): GroupAccExpr<V> => {
    /* The parameter type refuses every call at compile time; a JavaScript caller passes the server spec. */
    const js = spec as unknown as JsAccumulatorSpec;
    return F.node("$accumulator", {
      init: functionSource(js.init),
      accumulate: functionSource(js.accumulate),
      accumulateArgs: js.accumulateArgs.map(ExprNodes.serialize),
      merge: functionSource(js.merge),
      ...(js.initArgs === undefined ? {} : { initArgs: js.initArgs.map(ExprNodes.serialize) }),
      ...(js.finalize === undefined ? {} : { finalize: functionSource(js.finalize) }),
      lang: "js",
    });
  },
  /**
   * `$function` (an expression in server-side JavaScript) is NOT supported: any call is a compile error whose text
   * says so and names the expression operators to use instead. A JavaScript caller still gets the expression built,
   * and the core refuses it before it is sent (`StrictModeError`, rule `sanitize`).
   *
   * @param spec - Not accepted: the parameter type is the compile error.
   * @returns Nothing usable: the pipeline is refused.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/function/
   */
  function: <V = never>(spec: FunctionRefused): Expr<V> => {
    /* The parameter type refuses every call at compile time; a JavaScript caller passes the server spec. */
    const js = spec as unknown as JsFunctionSpec;
    return F.node("$function", { body: functionSource(js.body), args: js.args.map(ExprNodes.serialize), lang: "js" });
  },
};

export { functionSource };
