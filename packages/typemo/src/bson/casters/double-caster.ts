import { Double } from "mongodb";
import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";

/**
 * BSON double. Hydrated as `number` (the driver promotes it to `number` on read); `encode` wraps it
 * in `Double` so an integral value is still stored as a double, not an int32. Accepts a finite
 * `number` and a `Double` wrapper (the same BSON type). No strings, booleans, `bigint`, `Long`,
 * arrays (history H015) or `valueOf()` objects.
 */
export class DoubleCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "Double";

  /**
   * Accepts a finite number or a `Double` wrapper.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The plain number.
   * @throws {CastError} When the input is neither a number nor a `Double`, or is `NaN` or infinite.
   */
  static cast(value: unknown, path = ""): number {
    const number = BsonGuards.isDouble(value) ? value.value : value;
    if (typeof number !== "number") {
      return CastSupport.reject(path, value, DoubleCaster.expected, "a number or a Double");
    }
    if (!Number.isFinite(number)) {
      return CastSupport.fail(path, value, DoubleCaster.expected, "finite", "NaN and Infinity are not allowed");
    }
    return number;
  }

  /**
   * Wraps the number in `Double` so an integral value is not stored as int32.
   *
   * @param value - The hydrated number.
   * @returns A `Double` wrapper.
   */
  static encode(value: number): Double {
    return new Double(value);
  }
}
