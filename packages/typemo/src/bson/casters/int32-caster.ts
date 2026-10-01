import { Int32 } from "mongodb";
import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";

/** The smallest int32 value. */
const INT32_MIN = -2_147_483_648;
/** The largest int32 value. */
const INT32_MAX = 2_147_483_647;

/**
 * BSON int32. Hydrated as `number`; `encode` wraps it in `Int32` so the wire type is fixed. Accepts
 * an `Int32` wrapper and an integral `number` in [-2^31, 2^31 - 1] (safe list: "integral number in
 * range → Int32"). No `'42'`, no `-42.4` (Mongoose rounds nothing but accepts `'-997.0'`), no
 * `true` → 1, no arrays (history H015), no silent overflow (bson's `new Int32(2 ** 32 + 5)` is 5).
 * `-0` becomes `0`: int32 has no negative zero.
 */
export class Int32Caster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "Int32";

  /**
   * Accepts an integral number in the int32 range or an `Int32` wrapper.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The plain number (`-0` normalized to `0`).
   * @throws {CastError} When the input is not a number, is `NaN`/infinite, fractional or out of range.
   */
  static cast(value: unknown, path = ""): number {
    const number = BsonGuards.isInt32(value) ? value.value : value;
    if (typeof number !== "number") {
      return CastSupport.reject(path, value, Int32Caster.expected, "an integer number or an Int32");
    }
    if (!Number.isFinite(number)) {
      return CastSupport.fail(path, value, Int32Caster.expected, "finite", "NaN and Infinity are not integers");
    }
    if (!Number.isInteger(number)) {
      return CastSupport.fail(path, value, Int32Caster.expected, "integer", "a fractional number is not an Int32");
    }
    if (number < INT32_MIN || number > INT32_MAX) {
      return CastSupport.fail(path, value, Int32Caster.expected, "range", "out of the Int32 range [-2^31, 2^31 - 1]");
    }
    return number === 0 ? 0 : number;
  }

  /**
   * Wraps the number in `Int32` so the wire type is fixed.
   *
   * @param value - The hydrated number.
   * @returns An `Int32` wrapper.
   */
  static encode(value: number): Int32 {
    return new Int32(value);
  }
}
