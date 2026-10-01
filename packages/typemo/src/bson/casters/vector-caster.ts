import { Binary } from "mongodb";
import { ConfigurationError } from "../../errors/configuration-error.ts";
import { BsonGuards } from "../bson-guards.ts";
import type { Vector } from "../bson-type-table.ts";
import { CastSupport } from "./cast-support.ts";
import type { ValueCaster } from "./value-caster.ts";

/**
 * Element type of a BSON vector (Binary subtype 9), as named by Atlas Vector Search.
 *
 * @example
 * ```ts
 * const dtype: VectorDtype = "float32";
 * ```
 */
export type VectorDtype = "int8" | "float32" | "packedBit";

/**
 * Options of `VectorCaster.of`.
 *
 * @example
 * ```ts
 * const options: VectorCasterOptions = { dtype: "float32", dimensions: 1536 };
 * ```
 */
export interface VectorCasterOptions {
  /** The element type of the vector. */
  readonly dtype: VectorDtype;
  /** Exact number of dimensions (elements; bits for `packedBit`). Omitted: any non-zero length. */
  readonly dimensions?: number;
}

/** The dtype byte of the vector header (`Binary.VECTOR_TYPE`). */
const DTYPE_BYTE: Readonly<Record<VectorDtype, number>> = {
  int8: Binary.VECTOR_TYPE.Int8,
  float32: Binary.VECTOR_TYPE.Float32,
  packedBit: Binary.VECTOR_TYPE.PackedBit,
};

/** The largest finite float32 value. */
const FLOAT32_MAX = 3.4028234663852886e38;

/**
 * BSON vector (Binary subtype 9), hydrated as a `Binary` (what the driver returns) typed `Vector`. Built only by
 * `VectorCaster.of({ dtype, dimensions })`. Accepts:
 * - a subtype-9 `Binary` of the same dtype with a valid header (native);
 * - a `number[]` (safe list: "number[] → Vector by dtype"): `int8` — integers in [-128, 127];
 *   `float32` — finite numbers within the float32 range, rounded to float32 like any float32
 *   vector; `packedBit` — bits 0/1;
 * - the typed array of the dtype: `Int8Array` for `int8`, `Float32Array` for
 *   `float32` (its elements must be finite). A typed array of another element type is refused
 *   (reason `type`): converting `Float32Array` → int8 would round silently.
 * The length must equal `dimensions` when set and is never 0.
 */
export class VectorCaster {
  /**
   * Builds a caster of vectors of one dtype.
   *
   * @param options - The dtype and, optionally, the exact number of dimensions.
   * @returns A caster of `Vector`.
   * @throws {ConfigurationError} For an unknown dtype or non-positive or non-integer `dimensions`.
   */
  static of(options: VectorCasterOptions): ValueCaster<Vector> {
    const { dtype, dimensions } = options;
    if (!(dtype in DTYPE_BYTE)) throw new ConfigurationError(`VectorCaster: unknown dtype "${dtype}"`);
    if (dimensions !== undefined && (!Number.isInteger(dimensions) || dimensions < 1)) {
      throw new ConfigurationError(`VectorCaster: dimensions must be a positive integer, got ${dimensions}`);
    }
    const expected = `Vector<${dtype}${dimensions === undefined ? "" : `, ${dimensions}`}>`;
    return {
      expected,
      cast: (value: unknown, path = ""): Vector => {
        const vector = BsonGuards.isBinary(value)
          ? VectorCaster.fromBinary(value, path, dtype, expected)
          : Array.isArray(value)
            ? VectorCaster.fromNumbers(value, path, dtype, expected)
            : VectorCaster.isTypedArrayOf(value, dtype)
              ? VectorCaster.fromNumbers(Array.from(value), path, dtype, expected)
              : CastSupport.reject(path, value, expected, VectorCaster.accepted(dtype));
        const length = VectorCaster.dimensionsOf(vector, dtype);
        if (length === 0) return CastSupport.fail(path, value, expected, "dimensions", "a vector cannot be empty");
        if (dimensions !== undefined && length !== dimensions) {
          return CastSupport.fail(
            path,
            value,
            expected,
            "dimensions",
            `expected ${dimensions} dimensions, got ${length}`,
          );
        }
        return vector;
      },
      encode: (value: Vector): Binary => value,
    };
  }

  /**
   * Whether a value is the typed array that is the native JavaScript form of a dtype (none for `packedBit`).
   *
   * @param value - The value to test.
   * @param dtype - The vector dtype.
   * @returns `true` for an `Int8Array` with `int8` or a `Float32Array` with `float32`.
   */
  private static isTypedArrayOf(value: unknown, dtype: VectorDtype): value is Int8Array | Float32Array {
    if (!ArrayBuffer.isView(value)) return false;
    const tag = Object.prototype.toString.call(value);
    return (
      (dtype === "int8" && tag === "[object Int8Array]") || (dtype === "float32" && tag === "[object Float32Array]")
    );
  }

  /**
   * The phrase listing the accepted inputs of a dtype, for the `type` error detail.
   *
   * @param dtype - The vector dtype.
   * @returns The phrase.
   */
  private static accepted(dtype: VectorDtype): string {
    switch (dtype) {
      case "int8":
        return "a subtype-9 Binary, a number[] or an Int8Array of int8";
      case "float32":
        return "a subtype-9 Binary, a number[] or a Float32Array of float32";
      case "packedBit":
        return "a subtype-9 Binary or a number[] of bits";
    }
  }

  /**
   * The number of dimensions of a vector (bits for `packedBit`); decoding validates the header.
   *
   * @param vector - The vector Binary.
   * @param dtype - The vector dtype.
   * @returns The number of dimensions.
   * @throws {Error} The bson error when the vector bytes are malformed.
   */
  private static dimensionsOf(vector: Binary, dtype: VectorDtype): number {
    switch (dtype) {
      case "int8":
        return vector.toInt8Array().length;
      case "float32":
        return vector.toFloat32Array().length;
      case "packedBit":
        return vector.toBits().length;
    }
  }

  /**
   * Validates a subtype-9 Binary of the wanted dtype and copies it.
   *
   * @param value - The Binary input.
   * @param path - Dotted path of the value, used in error messages.
   * @param dtype - The dtype the vector must have.
   * @param expected - The expected type in the vocabulary of error messages.
   * @returns A copy of the vector.
   * @throws {CastError} When the subtype or dtype differs or the vector bytes are invalid.
   */
  private static fromBinary(value: Binary, path: string, dtype: VectorDtype, expected: string): Binary {
    if (value.sub_type !== Binary.SUBTYPE_VECTOR) {
      return CastSupport.fail(path, value, expected, "subtype", `expected subtype 9, got ${value.sub_type}`);
    }
    const header = value.buffer[0];
    if (header !== DTYPE_BYTE[dtype]) {
      return CastSupport.fail(path, value, expected, "subtype", `the vector is not of dtype ${dtype}`);
    }
    const copy = new Binary(CastSupport.copyBytes(value), Binary.SUBTYPE_VECTOR);
    try {
      /* bson validates the header (padding, byte length) when decoding; a broken vector throws here. */
      VectorCaster.dimensionsOf(copy, dtype);
    } catch (error) {
      return CastSupport.failWithCause(path, value, expected, "format", "invalid vector bytes", error);
    }
    return copy;
  }

  /**
   * Builds a vector Binary from a list of numbers, checking every element.
   *
   * @param values - The raw elements.
   * @param path - Dotted path of the list, used in error messages.
   * @param dtype - The vector dtype.
   * @param expected - The expected type in the vocabulary of error messages.
   * @returns The vector Binary.
   * @throws {CastError} When an element is not a valid value of the dtype.
   */
  private static fromNumbers(values: readonly unknown[], path: string, dtype: VectorDtype, expected: string): Binary {
    const numbers = values.map((item, index) =>
      VectorCaster.element(item, CastSupport.join(path, index), dtype, expected),
    );
    switch (dtype) {
      case "int8":
        return Binary.fromInt8Array(Int8Array.from(numbers));
      case "float32":
        return Binary.fromFloat32Array(Float32Array.from(numbers));
      case "packedBit":
        return Binary.fromBits(numbers);
    }
  }

  /**
   * Checks one vector element against the dtype.
   *
   * @param item - The raw element.
   * @param path - Dotted path of the element, used in error messages.
   * @param dtype - The vector dtype.
   * @param expected - The expected type in the vocabulary of error messages.
   * @returns The element, unchanged.
   * @throws {CastError} When the element is not a finite number, or is out of range for the dtype.
   */
  private static element(item: unknown, path: string, dtype: VectorDtype, expected: string): number {
    if (typeof item !== "number") return CastSupport.reject(path, item, expected, `a ${dtype} element (number)`);
    if (!Number.isFinite(item))
      return CastSupport.fail(path, item, expected, "finite", "NaN and Infinity are not allowed");
    switch (dtype) {
      case "int8":
        if (!Number.isInteger(item))
          return CastSupport.fail(path, item, expected, "integer", "int8 elements are integers");
        if (item < -128 || item > 127)
          return CastSupport.fail(path, item, expected, "range", "out of the int8 range [-128, 127]");
        return item;
      case "float32":
        if (Math.abs(item) > FLOAT32_MAX)
          return CastSupport.fail(path, item, expected, "range", "out of the float32 range");
        return item;
      case "packedBit":
        if (item !== 0 && item !== 1) return CastSupport.fail(path, item, expected, "range", "a bit is 0 or 1");
        return item;
    }
  }
}
