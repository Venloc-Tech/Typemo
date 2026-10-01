import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";

/** The smallest int64 value. */
const INT64_MIN = -(2n ** 63n);
/** The largest int64 value. */
const INT64_MAX = 2n ** 63n - 1n;
/*
 * The canonical decimal form of an integer — what `String(bigint)` writes (the plain / JSON form of int64).
 * No sign "+", no leading zeros, no "-0", no spaces, no exponent, no hex / binary / octal prefix.
 */
const DECIMAL_INTEGER = /^(?:0|-?[1-9][0-9]*)$/;
/** Longer than "-9223372036854775808" is out of the int64 range without parsing (no BigInt of a megabyte string). */
const MAX_DECIMAL_LENGTH = 20;
/** What to pass instead of a number that is not a safe integer. */
const NUMBER_HINT = 'pass a bigint (5n) or a decimal integer string ("5")';

/**
 * BSON int64 (`long`), hydrated as `bigint` (the driver returns `bigint` because
 * `useBigInt64` is enforced, see `BsonOptions`). Accepts a `bigint` and a `Long` in the int64 range,
 * a safe-integer `number` (safe list: "integral number in range → Long") and a strictly decimal integer string
 * (the plain / JSON form of int64 goes back in). A number beyond `Number.MAX_SAFE_INTEGER` is
 * refused: its precision is already lost, pass a `bigint`. Any other string (`"1.5"`, `"1e3"`, `" 1"`, `"+1"`,
 * `"0x10"`, `"01"`, `"-0"`, `""`) is a `format` error. Out of the int64 range is an error, not an overflow
 * (Mongoose gh-15200 / history H135).
 */
export class BigIntCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "Long";

  /**
   * Accepts a `bigint`, a `Long`, a safe-integer number or a decimal integer string in the int64 range.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The value as a `bigint`.
   * @throws {CastError} When the input has another type, is malformed or is out of the int64 range.
   */
  static cast(value: unknown, path = ""): bigint {
    if (typeof value === "number") return BigIntCaster.fromNumber(value, path);
    if (typeof value === "string") return BigIntCaster.fromString(value, path);
    const bigint = BsonGuards.isLong(value) ? value.toBigInt() : value;
    if (typeof bigint !== "bigint") {
      return CastSupport.reject(
        path,
        value,
        BigIntCaster.expected,
        "a bigint, a Long, a safe integer number or a decimal integer string",
      );
    }
    if (bigint < INT64_MIN || bigint > INT64_MAX) {
      return CastSupport.fail(path, value, BigIntCaster.expected, "range", "out of the int64 range [-2^63, 2^63 - 1]");
    }
    return bigint;
  }

  /**
   * Returns the `bigint` as the driver value (the driver writes it as int64).
   *
   * @param value - The hydrated `bigint`.
   * @returns The same `bigint`.
   */
  static encode(value: bigint): bigint {
    return value;
  }

  /**
   * Parses a strictly decimal integer string.
   *
   * @param value - The string input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The parsed `bigint`.
   * @throws {CastError} When the string is not a canonical decimal integer or is out of the int64 range.
   */
  private static fromString(value: string, path: string): bigint {
    if (!DECIMAL_INTEGER.test(value)) {
      return CastSupport.fail(
        path,
        value,
        BigIntCaster.expected,
        "format",
        "a string must be a decimal integer (no sign +, leading zeros, -0, spaces, exponent or prefix)",
      );
    }
    const bigint = value.length > MAX_DECIMAL_LENGTH ? undefined : BigInt(value);
    if (bigint === undefined || bigint < INT64_MIN || bigint > INT64_MAX) {
      return CastSupport.fail(path, value, BigIntCaster.expected, "range", "out of the int64 range [-2^63, 2^63 - 1]");
    }
    return bigint;
  }

  /**
   * Converts a safe-integer number.
   *
   * @param value - The number input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The number as a `bigint`.
   * @throws {CastError} When the number is not finite, is fractional or exceeds `Number.MAX_SAFE_INTEGER`.
   */
  private static fromNumber(value: number, path: string): bigint {
    if (!Number.isFinite(value)) {
      return CastSupport.fail(
        path,
        value,
        BigIntCaster.expected,
        "finite",
        `NaN and Infinity are not integers; ${NUMBER_HINT}`,
      );
    }
    if (!Number.isInteger(value)) {
      return CastSupport.fail(
        path,
        value,
        BigIntCaster.expected,
        "integer",
        `a fractional number is not an int64; ${NUMBER_HINT}`,
      );
    }
    if (!Number.isSafeInteger(value)) {
      return CastSupport.fail(
        path,
        value,
        BigIntCaster.expected,
        "precision",
        `beyond Number.MAX_SAFE_INTEGER the number is already imprecise; ${NUMBER_HINT}`,
      );
    }
    return BigInt(value);
  }
}
