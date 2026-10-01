import { Binary } from "mongodb";
import { ConfigurationError } from "../../errors/configuration-error.ts";
import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";
import type { ValueCaster } from "./value-caster.ts";

/**
 * Options of a Binary caster of a specific subtype.
 *
 * @example
 * ```ts
 * const options: BinaryCasterOptions = { subtype: 128 };
 * BinaryCaster.of(options); // a caster of user-defined Binary subtype 128
 * ```
 */
export interface BinaryCasterOptions {
  /** Binary subtype: 0, 1, 5–8 or a user-defined 128–255. */
  readonly subtype: number;
}

/**
 * Subtypes that have their own caster or are legacy: 2 (old binary, deprecated by the BSON spec),
 * 3 (old UUID byte order), 4 (`UuidCaster`), 9 (`VectorCaster`).
 */
const RESERVED_SUBTYPES: Readonly<Record<number, string>> = {
  2: "subtype 2 is deprecated by the BSON specification",
  3: "subtype 3 is the legacy UUID byte order; use UuidCaster (subtype 4)",
  4: "subtype 4 is a UUID; use UuidCaster",
  9: "subtype 9 is a vector; use VectorCaster",
};

/**
 * BSON binary, hydrated as `Binary` (never `Buffer`: `promoteBuffers: false`). The class itself
 * casts generic binary (subtype 0); `BinaryCaster.of({ subtype })` makes a caster of another
 * subtype. Accepts a `Binary` of exactly that subtype and a `Uint8Array`/`Buffer` (the driver's own
 * JavaScript form of BSON binary). The result is
 * always a copy: bytes are mutable. Refused: strings (Mongoose: UTF-8 bytes), numbers
 * (Mongoose: one byte), `number[]`, `{ type: 'Buffer', data }`, EJSON `{ $binary }` (history H167).
 */
export class BinaryCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "Binary";

  /**
   * Casts generic binary (subtype 0).
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns A new `Binary` with copied bytes.
   * @throws {CastError} When the input is not a `Binary` of subtype 0 or a `Uint8Array`.
   */
  static cast(value: unknown, path = ""): Binary {
    return BinaryCaster.castSubtype(value, path, Binary.SUBTYPE_DEFAULT, BinaryCaster.expected);
  }

  /**
   * Returns the `Binary` as the driver value.
   *
   * @param value - The hydrated `Binary`.
   * @returns The same `Binary`.
   */
  static encode(value: Binary): Binary {
    return value;
  }

  /**
   * A caster of Binary values of one subtype.
   *
   * @param options - The subtype to accept.
   * @returns A caster of `Binary` of that subtype.
   * @throws {ConfigurationError} For a reserved or invalid subtype.
   */
  static of(options: BinaryCasterOptions): ValueCaster<Binary> {
    const { subtype } = options;
    if (!Number.isInteger(subtype) || subtype < 0 || subtype > 255) {
      throw new ConfigurationError(`BinaryCaster: subtype must be an integer 0–255, got ${subtype}`);
    }
    const reserved = RESERVED_SUBTYPES[subtype];
    if (reserved !== undefined) throw new ConfigurationError(`BinaryCaster: ${reserved}`);
    const expected = subtype === Binary.SUBTYPE_DEFAULT ? BinaryCaster.expected : `Binary(subtype ${subtype})`;
    return {
      expected,
      cast: (value: unknown, path = ""): Binary => BinaryCaster.castSubtype(value, path, subtype, expected),
      encode: BinaryCaster.encode,
    };
  }

  /**
   * Casts a `Binary` or a `Uint8Array` to a copied `Binary` of the given subtype.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @param subtype - The subtype the result must have.
   * @param expected - The expected type in the vocabulary of error messages.
   * @returns A new `Binary` with copied bytes.
   * @throws {CastError} When the input has another type or a different subtype.
   */
  private static castSubtype(value: unknown, path: string, subtype: number, expected: string): Binary {
    if (BsonGuards.isBinary(value)) {
      if (value.sub_type !== subtype) {
        return CastSupport.fail(path, value, expected, "subtype", `expected subtype ${subtype}, got ${value.sub_type}`);
      }
      return new Binary(CastSupport.copyBytes(value), subtype);
    }
    if (BsonGuards.isUint8Array(value)) return new Binary(Uint8Array.prototype.slice.call(value), subtype);
    return CastSupport.reject(path, value, expected, "a Binary or a Uint8Array");
  }
}
