import { CastSupport } from "./cast-support.ts";

/**
 * BSON string. Only a `string` passes: no `toString()` heuristics (Mongoose turned a `Date` into a
 * locale string and a Buffer into UTF-8 text). `''` stays `''`.
 */
export class StringCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "string";

  /**
   * Passes a string through.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The same string.
   * @throws {CastError} When the input is not a string.
   */
  static cast(value: unknown, path = ""): string {
    return typeof value === "string" ? value : CastSupport.reject(path, value, StringCaster.expected, "a string");
  }

  /**
   * Returns the string as the driver value.
   *
   * @param value - The hydrated string.
   * @returns The same string.
   */
  static encode(value: string): string {
    return value;
  }
}
