import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";

/** The only JavaScript flags whose meaning survives a write and a read (`bsonRegExp: false`). */
const SURVIVING_FLAGS = new Set(["i", "m"]);

/**
 * BSON regular expression stored from a native `RegExp` (`bsonRegExp: false`: reads give
 * a native `RegExp`). The serializer writes only `i`, `m` and — as BSON `s` — JavaScript `g`; the
 * deserializer maps BSON `s` back to `g`. So:
 * - `i` and `m` round-trip;
 * - `g` would be stored as BSON `s` (dotAll on the server!) — refused;
 * - `s`, `u`, `v`, `y`, `d` are silently dropped by the serializer — refused.
 * The result is a fresh `RegExp` (no shared `lastIndex`).
 */
export class RegExpCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "RegExp";

  /**
   * Accepts a `RegExp` whose flags survive a BSON round trip and returns a fresh copy.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns A new `RegExp` with the same source and flags.
   * @throws {CastError} When the input is not a `RegExp`, or has flags other than `i` and `m`.
   */
  static cast(value: unknown, path = ""): RegExp {
    if (!BsonGuards.isRegExp(value)) return CastSupport.reject(path, value, RegExpCaster.expected, "a RegExp");
    const lost = [...value.flags].filter((flag) => !SURVIVING_FLAGS.has(flag));
    if (lost.length > 0) {
      return CastSupport.fail(
        path,
        value,
        RegExpCaster.expected,
        "flags",
        `flags "${lost.join("")}" do not survive a BSON round trip; only "i" and "m" do`,
      );
    }
    return new RegExp(value.source, value.flags);
  }

  /**
   * Returns the `RegExp` as the driver value.
   *
   * @param value - The hydrated `RegExp`.
   * @returns The same `RegExp`.
   */
  static encode(value: RegExp): RegExp {
    return value;
  }
}
