import { Decimal128 } from "mongodb";
import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";

/** Plain decimal notation with an optional exponent, or one of the three special values. */
const DECIMAL_FORMAT = /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|NaN|-?Infinity)$/;

/**
 * BSON decimal128, hydrated as `Decimal128` (no arithmetic). Accepts a `Decimal128`, a
 * string in decimal notation that Decimal128 holds exactly (safe list: "valid string → Decimal128"),
 * and a finite `number` through its shortest JS decimal form `String(n)` (`19.99` →
 * `"19.99"`, what the user wrote; `NaN`/`±Infinity` are refused — use the strings `"NaN"`/`"Infinity"`;
 * `-0` becomes `0`, as `String(-0)` is `"0"`). No whitespace, no hex, no
 * `valueOf()` objects (Mongoose gh-6418). A string with more precision than 34 digits is refused
 * (bson's inexact-rounding error is kept as `cause`), not rounded.
 */
export class Decimal128Caster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "Decimal128";

  /**
   * Accepts a `Decimal128`, a decimal string or a finite number.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The `Decimal128` (the same instance when one was given).
   * @throws {CastError} When the input has another type, is not a decimal string, is not finite or the
   * string needs more precision than Decimal128 holds.
   */
  static cast(value: unknown, path = ""): Decimal128 {
    if (BsonGuards.isDecimal128(value)) return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return CastSupport.fail(
          path,
          value,
          Decimal128Caster.expected,
          "finite",
          'a number must be finite (write "NaN"/"Infinity" as strings)',
        );
      }
      return Decimal128Caster.cast(String(value), path);
    }
    if (typeof value !== "string") {
      return CastSupport.reject(
        path,
        value,
        Decimal128Caster.expected,
        "a Decimal128, a decimal string or a finite number",
      );
    }
    if (!DECIMAL_FORMAT.test(value)) {
      return CastSupport.fail(path, value, Decimal128Caster.expected, "format", "not a decimal number string");
    }
    try {
      return Decimal128.fromString(value);
    } catch (error) {
      return CastSupport.failWithCause(
        path,
        value,
        Decimal128Caster.expected,
        "precision",
        "Decimal128 cannot hold this number exactly",
        error,
      );
    }
  }

  /**
   * Returns the `Decimal128` as the driver value.
   *
   * @param value - The hydrated `Decimal128`.
   * @returns The same `Decimal128`.
   */
  static encode(value: Decimal128): Decimal128 {
    return value;
  }
}
