/* Ported from mongoose test/types.number.test.js (SchemaNumber#cast) onto Typemo's NumberCaster. */
import { describe, expect, test } from "bun:test";
import { NumberCaster } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

describe("types.number", () => {
  // ported from mongoose test/types.number.test.js:18 "an empty string casts to null"
  test("an empty string casts to null — divergence: CastError ('' is never null)", () => {
    expect(castFailure(() => NumberCaster.cast("")).reason).toBe("type");
  });

  // ported from mongoose test/types.number.test.js:30 "array throws cast number error"
  test("array throws cast number error", () => {
    expect(castFailure(() => NumberCaster.cast([])).name).toBe("CastError");
  });

  // ported from mongoose test/types.number.test.js:42 "three throws cast number error"
  test("three throws cast number error", () => {
    expect(castFailure(() => NumberCaster.cast("three")).name).toBe("CastError");
  });

  // ported from mongoose test/types.number.test.js:54 "{} throws cast number error"
  test("{} throws cast number error", () => {
    expect(castFailure(() => NumberCaster.cast({})).name).toBe("CastError");
  });

  // ported from mongoose test/types.number.test.js:66 "does not throw number cast error"
  test("does not throw number cast error — divergence: only the plain numbers pass", () => {
    // Mongoose: none of [1, '2', '0', null, '', new String('47'), new Number(5), Number(47), Number('09'), 0x12] throws.
    const passing = [1, Number(47), Number("09"), 0x12];
    const failing = ["2", "0", null, "", new String("47"), new Number(5)];
    expect(passing.map((item) => NumberCaster.cast(item))).toEqual([1, 47, 9, 18]);
    for (const item of failing) expect(castFailure(() => NumberCaster.cast(item)).name).toBe("CastError");
  });

  // ported from mongoose test/types.number.test.js:81 "boolean casts to 0/1 (gh-3475)"
  test("boolean casts to 0/1 (gh-3475) — divergence: CastError", () => {
    expect(castFailure(() => NumberCaster.cast(true)).reason).toBe("type");
    expect(castFailure(() => NumberCaster.cast(false)).reason).toBe("type");
  });

  // ported from mongoose test/types.number.test.js:88 "prefers valueOf function if one exists (gh-6299)"
  test("prefers valueOf function if one exists (gh-6299) — divergence: CastError", () => {
    const obj = { str: "10", valueOf: () => 10, toString: () => "11" };
    expect(castFailure(() => NumberCaster.cast(obj)).reason).toBe("type");
  });
});
