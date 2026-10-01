import type { Decimal128 } from "mongodb";
import { type AnyExprNode, ExprNodes } from "../expr-node.ts";
import type { Arg, Nullable, PropagateNull } from "../expr-types.ts";
import { type Expr, OperatorFactory as F } from "../operator-factory.ts";

/*
 * Arithmetic and trigonometry. Numbers are `number` (double/int32) or `bigint` (int64); the
 * arithmetic operators accept both, as the server does. `Decimal128` has no arithmetic in TypeScript
 * but the server computes with it: `$add`/`$multiply`/… accept it and return `Decimal128`.
 */

/**
 * A numeric BSON value: double/int32 (`number`), long (`bigint`) or decimal (`Decimal128`).
 *
 * @example
 * ```ts
 * const values: Numeric[] = [1.5, 2n, Decimal128.fromString("3.10")];
 * ```
 */
export type Numeric = number | bigint | Decimal128;

/**
 * The result of an arithmetic operator over numeric arguments, by the server's widening rules:
 * any decimal → `Decimal128`; any double → `number`; only longs → `bigint` (int32 + long → long, but
 * both int32 and double are `number` in TypeScript, so `number` + `bigint` is typed `number | bigint`).
 *
 * @typeParam V - The union of the argument value types.
 * @example
 * ```ts
 * type A = NumericResult<number>; // number
 * type B = NumericResult<bigint>; // bigint
 * type C = NumericResult<number | bigint>; // number | bigint
 * type D = NumericResult<number | Decimal128>; // Decimal128
 * ```
 */
export type NumericResult<V> = [Extract<V, Decimal128>] extends [never]
  ? [Extract<V, number>] extends [never]
    ? [Extract<V, bigint>] extends [never]
      ? number
      : bigint
    : [Extract<V, bigint>] extends [never]
      ? number
      : number | bigint
  : Decimal128;

/**
 * A numeric argument: an expression or a bare number, possibly `null`/missing.
 *
 * @example
 * ```ts
 * const a: NumericArg = 1;
 * const b: NumericArg = f.price;
 * ```
 */
type NumericArg = Arg<Nullable<Numeric>>;

/**
 * The value type of an argument: `V` of an expression, the type itself for a bare value.
 *
 * @typeParam A - The argument type.
 * @example
 * ```ts
 * type A = ValueOf<Expr<number>>; // number
 * type B = ValueOf<bigint>; // bigint
 * ```
 */
type ValueOf<A> = A extends Expr<infer V> ? V : A;

/**
 * `$add`: numbers, or numbers added to one `Date` (milliseconds). Overloaded like the server.
 *
 * @example
 * ```ts
 * fn.add(f.price, 1); // Expr<number>
 * fn.add(f.createdAt, 86_400_000); // Expr<Date>
 * ```
 */
export interface AddOp {
  /**
   * Sum of numbers.
   *
   * @param args - The numbers.
   * @returns The sum, widened by the server's rules; `null` when an argument can be `null`.
   */
  <R extends readonly NumericArg[]>(
    ...args: R
  ): Expr<PropagateNull<NumericResult<Exclude<ValueOf<R[number]>, null | undefined>>, R[number]>>;
  /**
   * A date plus milliseconds.
   *
   * @param date - The date.
   * @param ms - The milliseconds to add.
   * @returns The later date; `null` when an argument can be `null`.
   */
  <A extends Arg<Nullable<Date>>, R extends readonly Arg<Nullable<number>>[]>(
    date: A,
    ...ms: R
  ): Expr<PropagateNull<Date, A | R[number]>>;
  /**
   * Milliseconds plus a date.
   *
   * @param ms - The first number of milliseconds.
   * @param date - The date.
   * @param rest - More milliseconds.
   * @returns The later date; `null` when an argument can be `null`.
   */
  <N extends Arg<Nullable<number>>, D extends Arg<Nullable<Date>>, R extends readonly Arg<Nullable<number>>[]>(
    ms: N,
    date: D,
    ...rest: R
  ): Expr<PropagateNull<Date, N | D | R[number]>>;
}

/**
 * `$subtract`: `number - number`, `Date - Date` (milliseconds, an int64: `bigint`), `Date - number` (a `Date`).
 *
 * @example
 * ```ts
 * fn.subtract(f.total, f.discount); // Expr<number>
 * fn.subtract(f.endedAt, f.startedAt); // Expr<bigint> (milliseconds)
 * fn.subtract(f.endedAt, 1000); // Expr<Date>
 * ```
 */
export interface SubtractOp {
  /**
   * Difference of numbers.
   *
   * @param a - The minuend.
   * @param b - The subtrahend.
   * @returns The difference, widened by the server's rules; `null` when an argument can be `null`.
   */
  <A extends NumericArg, B extends NumericArg>(
    a: A,
    b: B,
  ): Expr<PropagateNull<NumericResult<Exclude<ValueOf<A | B>, null | undefined>>, A | B>>;
  /**
   * Difference of two dates in milliseconds.
   *
   * @param a - The later date.
   * @param b - The earlier date.
   * @returns The difference in milliseconds; `null` when an argument can be `null`.
   */
  <A extends Arg<Nullable<Date>>, B extends Arg<Nullable<Date>>>(a: A, b: B): Expr<PropagateNull<bigint, A | B>>;
  /**
   * A date minus milliseconds.
   *
   * @param a - The date.
   * @param b - The milliseconds to subtract.
   * @returns The earlier date; `null` when an argument can be `null`.
   */
  <A extends Arg<Nullable<Date>>, B extends Arg<Nullable<number>>>(a: A, b: B): Expr<PropagateNull<Date, A | B>>;
}

/** The `$add` operator. */
const add = ((...args: readonly unknown[]): AnyExprNode => F.node("$add", args.map(ExprNodes.serialize))) as AddOp;

/** The `$subtract` operator. */
const subtract = ((a: unknown, b: unknown): AnyExprNode =>
  F.node("$subtract", [ExprNodes.serialize(a), ExprNodes.serialize(b)])) as SubtractOp;

/**
 * Builds a variadic (2+) numeric operator that passes `null` through.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator; the result is widened by the server's rules.
 */
const numericVariadic =
  (op: string) =>
  <A extends NumericArg, B extends NumericArg, R extends readonly NumericArg[]>(
    a: A,
    b: B,
    ...rest: R
  ): Expr<PropagateNull<NumericResult<Exclude<ValueOf<A | B | R[number]>, null | undefined>>, A | B | R[number]>> =>
    F.node(op, [a, b, ...rest].map(ExprNodes.serialize));

/**
 * Builds a unary numeric operator that passes `null` through.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator; the result has the widened type of its argument.
 */
const numericUnary =
  (op: string) =>
  <A extends NumericArg>(x: A): Expr<PropagateNull<NumericResult<Exclude<ValueOf<A>, null | undefined>>, A>> =>
    F.node(op, ExprNodes.serialize(x));

/**
 * Builds a `$round` / `$trunc` operator: the number, and an optional decimal place.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator taking `(value, place?)`.
 */
const rounding =
  (op: string) =>
  <A extends NumericArg, P extends Arg<Nullable<number>> | undefined = undefined>(
    value: A,
    place?: P,
  ): Expr<PropagateNull<NumericResult<Exclude<ValueOf<A>, null | undefined>>, A | Exclude<P, undefined>>> =>
    F.node(
      op,
      place === undefined ? [ExprNodes.serialize(value)] : [ExprNodes.serialize(value), ExprNodes.serialize(place)],
    );

/**
 * Builds a transcendental operator: a double, or a decimal for a decimal input.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed unary operator; `null` when the argument can be `null`.
 */
const toDouble =
  (op: string) =>
  <A extends NumericArg>(x: A): Expr<PropagateNull<DoubleOrDecimal<A>, A>> =>
    F.node(op, ExprNodes.serialize(x));

/**
 * A double, or a decimal when the argument can be a decimal.
 *
 * @typeParam A - The argument type.
 * @example
 * ```ts
 * type A = DoubleOrDecimal<Expr<number>>; // number
 * type B = DoubleOrDecimal<Expr<Decimal128>>; // Decimal128
 * ```
 */
type DoubleOrDecimal<A> = [Extract<ValueOf<A>, Decimal128>] extends [never] ? number : Decimal128;

/** Arithmetic and trigonometry operators. */
export const arithmeticOps = {
  /**
   * Absolute value.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/abs/
   */
  abs: numericUnary("$abs"),
  /**
   * Smallest integer ≥ the number.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/ceil/
   */
  ceil: numericUnary("$ceil"),
  /**
   * Largest integer ≤ the number.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/floor/
   */
  floor: numericUnary("$floor"),
  /**
   * Square root (a double).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sqrt/
   */
  sqrt: toDouble("$sqrt"),
  /**
   * `e` to the power.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/exp/
   */
  exp: toDouble("$exp"),
  /**
   * Natural logarithm.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/ln/
   */
  ln: toDouble("$ln"),
  /**
   * Base-10 logarithm.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/log10/
   */
  log10: toDouble("$log10"),
  /**
   * Sine (radians).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sin/
   */
  sin: toDouble("$sin"),
  /**
   * Cosine (radians).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/cos/
   */
  cos: toDouble("$cos"),
  /**
   * Tangent (radians).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/tan/
   */
  tan: toDouble("$tan"),
  /**
   * Arc sine (radians).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/asin/
   */
  asin: toDouble("$asin"),
  /**
   * Arc cosine (radians).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/acos/
   */
  acos: toDouble("$acos"),
  /**
   * Arc tangent (radians).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/atan/
   */
  atan: toDouble("$atan"),
  /**
   * Hyperbolic arc sine.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/asinh/
   */
  asinh: toDouble("$asinh"),
  /**
   * Hyperbolic arc cosine.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/acosh/
   */
  acosh: toDouble("$acosh"),
  /**
   * Hyperbolic arc tangent.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/atanh/
   */
  atanh: toDouble("$atanh"),
  /**
   * Hyperbolic sine.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sinh/
   */
  sinh: toDouble("$sinh"),
  /**
   * Hyperbolic cosine.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/cosh/
   */
  cosh: toDouble("$cosh"),
  /**
   * Hyperbolic tangent.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/tanh/
   */
  tanh: toDouble("$tanh"),
  /**
   * Degrees → radians.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/degreesToRadians/
   */
  degreesToRadians: toDouble("$degreesToRadians"),
  /**
   * Radians → degrees.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/radiansToDegrees/
   */
  radiansToDegrees: toDouble("$radiansToDegrees"),
  /**
   * `1 / (1 + e^-x)` (MongoDB 8.3+), `null` for a `null`/missing input. The server accepts only the bare
   * form `{ $sigmoid: <expr> }`: the documented `{ input, onNull }` form fails on 8.3.11 and 9.0.0-rc0
   * ("$multiply only supports numeric types, not object", test `aggregate/server-rules`); use `fn.ifNull`
   * for a replacement.
   *
   * @param x - The number.
   * @returns The sigmoid of the number.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/sigmoid/
   */
  sigmoid: <A extends NumericArg>(x: A): Expr<PropagateNull<number, A>> => F.node("$sigmoid", ExprNodes.serialize(x)),

  /**
   * Sum of numbers, or `Date` + milliseconds.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/add/
   */
  add,
  /**
   * Difference; `Date - Date` is milliseconds, `Date - number` a `Date`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/subtract/
   */
  subtract,
  /**
   * Product of 2+ numbers.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/multiply/
   */
  multiply: numericVariadic("$multiply"),
  /**
   * Quotient (always a double or a decimal).
   *
   * @param a - The dividend.
   * @param b - The divisor.
   * @returns The quotient; `null` when an argument can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/divide/
   */
  divide: <A extends NumericArg, B extends NumericArg>(
    a: A,
    b: B,
  ): Expr<PropagateNull<DoubleOrDecimal<A | B>, A | B>> =>
    F.node("$divide", [ExprNodes.serialize(a), ExprNodes.serialize(b)]),
  /**
   * Remainder.
   *
   * @param a - The dividend.
   * @param b - The divisor.
   * @returns The remainder; `null` when an argument can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/mod/
   */
  mod: <A extends NumericArg, B extends NumericArg>(
    a: A,
    b: B,
  ): Expr<PropagateNull<NumericResult<Exclude<ValueOf<A | B>, null | undefined>>, A | B>> =>
    F.node("$mod", [ExprNodes.serialize(a), ExprNodes.serialize(b)]),
  /**
   * Power.
   *
   * @param a - The base.
   * @param b - The exponent.
   * @returns The power; `null` when an argument can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/pow/
   */
  pow: <A extends NumericArg, B extends NumericArg>(
    a: A,
    b: B,
  ): Expr<PropagateNull<NumericResult<Exclude<ValueOf<A | B>, null | undefined>>, A | B>> =>
    F.node("$pow", [ExprNodes.serialize(a), ExprNodes.serialize(b)]),
  /**
   * Logarithm in a base.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/log/
   */
  log: F.binaryNull<Numeric, number>("$log"),
  /**
   * Arc tangent of `y / x` (radians).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/atan2/
   */
  atan2: F.binaryNull<Numeric, number>("$atan2"),
  /**
   * Rounds to an integer or to `place` decimals.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/round/
   */
  round: rounding("$round"),
  /**
   * Truncates to an integer or to `place` decimals.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/trunc/
   */
  trunc: rounding("$trunc"),
};
