import { CastSupport } from "./cast-support.ts";

/**
 * A JavaScript `number` field. On the wire it is int32 or double depending on the value (the
 * serializer decides; use `Int32Caster`/`DoubleCaster` to fix the BSON type). Only a finite `number`
 * passes: no numeric strings (`'42'`, `' '` → 0, `'0x10'` → 16), no `true` → 1, no `Date` → ms,
 * no `valueOf()` objects, no `NaN`/`±Infinity` (they have no JSON form and are almost always a bug).
 */
export class NumberCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "number";

  /**
   * Passes a finite number through.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The same number.
   * @throws {CastError} When the input is not a number, or is `NaN` or infinite.
   */
  static cast(value: unknown, path = ""): number {
    if (typeof value !== "number") return CastSupport.reject(path, value, NumberCaster.expected, "a number");
    if (!Number.isFinite(value)) {
      return CastSupport.fail(path, value, NumberCaster.expected, "finite", "NaN and Infinity are not allowed");
    }
    return value;
  }

  /**
   * Returns the number as the driver value; the serializer picks int32 or double.
   *
   * @param value - The hydrated number.
   * @returns The same number.
   */
  static encode(value: number): number {
    return value;
  }
}
