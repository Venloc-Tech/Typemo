import { UUID } from "mongodb";
import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";

/** Canonical textual UUID (RFC 9562): 8-4-4-4-12 hex digits, any case, any version (nil and max included). */
const UUID_TEXT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * BSON UUID (Binary subtype 4), hydrated as `UUID` — what the driver returns for a valid subtype 4.
 * Accepts a `UUID`, a Binary of subtype 4 with 16 bytes (the same BSON value) and a canonical UUID
 * string (safe list: "UUID string → UUID"). Refused: 32-hex without dashes, braces, `urn:uuid:`,
 * other Binary subtypes (legacy subtype 3 included), raw `Uint8Array`. Always a fresh `UUID`: the
 * bytes of a Binary are mutable.
 */
export class UuidCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "UUID";

  /**
   * Accepts a `UUID`, a subtype 4 Binary of 16 bytes or a canonical UUID string.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns A fresh `UUID`.
   * @throws {CastError} When the input has another type, subtype or is not a canonical UUID string.
   */
  static cast(value: unknown, path = ""): UUID {
    if (BsonGuards.isBinary(value)) {
      if (!BsonGuards.isUuid(value)) {
        return CastSupport.fail(
          path,
          value,
          UuidCaster.expected,
          "subtype",
          `expected a Binary of subtype 4 with 16 bytes, got subtype ${value.sub_type} with ${value.position} bytes`,
        );
      }
      return new UUID(CastSupport.copyBytes(value));
    }
    if (typeof value !== "string") {
      return CastSupport.reject(path, value, UuidCaster.expected, "a UUID or a UUID string");
    }
    if (!UUID_TEXT.test(value)) {
      return CastSupport.fail(path, value, UuidCaster.expected, "format", "not a UUID string (8-4-4-4-12 hex digits)");
    }
    return new UUID(value);
  }

  /**
   * Returns the `UUID` as the driver value.
   *
   * @param value - The hydrated `UUID`.
   * @returns The same `UUID`.
   */
  static encode(value: UUID): UUID {
    return value;
  }
}
