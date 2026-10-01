/* Ported from mongoose test/types.decimal128.test.js onto Typemo's Decimal128Caster. */
import { describe, expect, test } from "bun:test";
import { Decimal128Caster, SubdocumentCaster } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

const BigNum = SubdocumentCaster.of({ value: Decimal128Caster });

describe("types.decimal128", () => {
  // ported from mongoose test/types.decimal128.test.js:19 "casts from type number (gh-6331)"
  test("casts from type number (gh-6331) (the number goes through String(n))", () => {
    expect(BigNum.cast({ value: 10000 }).value?.toString()).toBe("10000");
    expect(BigNum.cast({ value: "10000" }).value?.toString()).toBe("10000");
    expect(castFailure(() => BigNum.cast({ value: Number.NaN })).reason).toBe("finite");
  });

  // ported from mongoose test/types.decimal128.test.js:31 "uses valueOf method if one exists (gh-6418)"
  test("uses valueOf method if one exists (gh-6418) — divergence: CastError", () => {
    const obj = { str: "10.123", valueOf: () => "10.123" };
    expect(castFailure(() => BigNum.cast({ value: obj })).reason).toBe("type");
  });
});
