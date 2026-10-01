import { CastSupport } from "./cast-support.ts";

/**
 * BSON boolean. Only `true` / `false`: no `'true'`, `'yes'`, `1`, `0` (Mongoose's convertToTrue/False
 * tables, history H504).
 */
export class BooleanCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "boolean";

  /**
   * Passes a boolean through.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The same boolean.
   * @throws {CastError} When the input is not a boolean.
   */
  static cast(value: unknown, path = ""): boolean {
    return typeof value === "boolean"
      ? value
      : CastSupport.reject(path, value, BooleanCaster.expected, "true or false");
  }

  /**
   * Returns the boolean as the driver value.
   *
   * @param value - The hydrated boolean.
   * @returns The same boolean.
   */
  static encode(value: boolean): boolean {
    return value;
  }
}
