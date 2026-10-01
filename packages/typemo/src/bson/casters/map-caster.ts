import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";
import type { ValueCaster } from "./value-caster.ts";

/**
 * `Map<string, V>` stored as an embedded document. `MapCaster.of(value)` accepts:
 * - a `Map` (native);
 * - a literal object `{ gold: {...} }` (only for Map-typed fields — this is how Map
 *   data arrives from JSON; lossless and unambiguous). Class instances, arrays and objects with
 *   symbol keys are not records and are refused.
 *
 * Every key is checked and every value is cast into a new `Map`. `encode` gives a plain object:
 * that is what is stored and what lean returns.
 *
 * Keys MongoDB cannot store or address are refused (reason `key`): non-strings, `''`, keys with
 * `.` (they would be read as a path) or starting with `$` (operators), and `__proto__` (an
 * own `__proto__` key comes from `JSON.parse`).
 */
export class MapCaster {
  /**
   * Builds a caster of `Map<string, V>`.
   *
   * @typeParam V - The hydrated value type.
   * @param value - The caster applied to every map value.
   * @returns A caster of `Map<string, V>`.
   */
  static of<V>(value: ValueCaster<V>): ValueCaster<Map<string, V>> {
    const expected = `Map<string, ${value.expected}>`;
    return {
      expected,
      cast: (input: unknown, path = ""): Map<string, V> => {
        const entries = MapCaster.entriesOf(input, path, expected);
        const result = new Map<string, V>();
        for (const [key, item] of entries) {
          const keyPath = CastSupport.join(path, String(key));
          MapCaster.checkKey(key, keyPath, expected);
          result.set(key as string, value.cast(item, keyPath));
        }
        return result;
      },
      encode: (map: Map<string, V>): Record<string, unknown> =>
        Object.fromEntries([...map].map(([key, item]) => [key, value.encode(item)])),
    };
  }

  /**
   * The entries of a `Map` or of a literal object; anything else is a cast error.
   *
   * @param input - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @param expected - The expected type in the vocabulary of error messages.
   * @returns The entries to cast.
   * @throws {CastError} When the input is neither a `Map` nor a literal object, or has a symbol key.
   */
  private static entriesOf(input: unknown, path: string, expected: string): Iterable<readonly [unknown, unknown]> {
    if (BsonGuards.isMap(input)) return input;
    if (BsonGuards.isPojo(input)) {
      const [symbol] = Object.getOwnPropertySymbols(input);
      if (symbol !== undefined) {
        return CastSupport.fail(path, input, expected, "key", "Map keys must be strings (the object has a symbol key)");
      }
      return Object.entries(input);
    }
    return CastSupport.reject(path, input, expected, "a Map or a literal object of entries");
  }

  /**
   * Checks that a key can be stored and addressed by MongoDB.
   *
   * @param key - The map key.
   * @param path - Dotted path of the entry, used in error messages.
   * @param expected - The expected type in the vocabulary of error messages.
   * @throws {CastError} With reason `key` when the key is not a string, is empty, contains `.`, starts with `$`
   * or is `__proto__`.
   */
  private static checkKey(key: unknown, path: string, expected: string): void {
    if (typeof key !== "string") {
      CastSupport.fail(path, key, expected, "key", "Map keys must be strings");
    } else if (key === "") {
      CastSupport.fail(path, key, expected, "key", "an empty key cannot be addressed by a path");
    } else if (key.includes(".")) {
      CastSupport.fail(path, key, expected, "key", `a key cannot contain "." (it would be read as a path)`);
    } else if (key.startsWith("$")) {
      CastSupport.fail(path, key, expected, "key", `a key cannot start with "$" (reserved for operators)`);
    } else if (key === "__proto__") {
      CastSupport.fail(path, key, expected, "key", `"__proto__" is never stored`);
    }
  }
}
