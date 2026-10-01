/*
 * Ported from mongoose test/cast.number.test.js (castNumber) onto Typemo's NumberCaster.
 * Only a finite `number` passes. Each divergent test asserts Typemo's behavior and quotes
 * Mongoose's original expectation. See from-mongoose-to-typemo/DIVERGENCES.md.
 */
import { describe, expect, test } from "bun:test";
import { CastError, NullableCaster, NumberCaster } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

describe("castNumber()", () => {
  // ported from mongoose test/cast.number.test.js:8 "casts a numeric string to a number"
  test("casts a numeric string to a number — divergence: CastError", () => {
    // Mongoose: castNumber('42') === 42
    expect(castFailure(() => NumberCaster.cast("42")).reason).toBe("type");
  });

  // ported from mongoose test/cast.number.test.js:12 "casts a float string to a number"
  test("casts a float string to a number — divergence: CastError", () => {
    // Mongoose: castNumber('3.14') === 3.14
    expect(castFailure(() => NumberCaster.cast("3.14")).reason).toBe("type");
  });

  // ported from mongoose test/cast.number.test.js:16 "returns null when given null"
  test("returns null when given null — divergence: only on a nullable path", () => {
    // Mongoose: castNumber(null) === null on any path
    expect(castFailure(() => NumberCaster.cast(null)).reason).toBe("null");
    expect(NullableCaster.of(NumberCaster).cast(null)).toBeNull();
  });

  // ported from mongoose test/cast.number.test.js:20 "returns undefined when given undefined"
  test("returns undefined when given undefined — divergence: CastError", () => {
    // Mongoose: castNumber(undefined) === undefined
    expect(castFailure(() => NumberCaster.cast(undefined)).reason).toBe("undefined");
  });

  // ported from mongoose test/cast.number.test.js:24 "casts a Number instance to a primitive"
  test("casts a Number instance to a primitive — divergence: CastError", () => {
    // Mongoose: castNumber(new Number(7)) === 7
    expect(castFailure(() => NumberCaster.cast(new Number(7))).reason).toBe("type");
  });

  // ported from mongoose test/cast.number.test.js:28 "throws a plain Error (not AssertionError) for a non-numeric string"
  test("throws a plain Error (not AssertionError) for a non-numeric string", () => {
    // Typemo's own error class instead of a plain Error; the point — no AssertionError — holds.
    const error = castFailure(() => NumberCaster.cast("hello"));
    expect(error).toBeInstanceOf(CastError);
    expect(error.constructor.name).not.toBe("AssertionError");
    expect(error.message).toContain("Cast to number failed");
  });

  // ported from mongoose test/cast.number.test.js:45 "throws a plain Error (not AssertionError) for an object"
  test("throws a plain Error (not AssertionError) for an object", () => {
    expect(castFailure(() => NumberCaster.cast({})).constructor.name).toBe("CastError");
  });

  // ported from mongoose test/cast.number.test.js:57 "throws a plain Error (not AssertionError) for an array"
  test("throws a plain Error (not AssertionError) for an array", () => {
    expect(castFailure(() => NumberCaster.cast([1, 2])).constructor.name).toBe("CastError");
  });
});
