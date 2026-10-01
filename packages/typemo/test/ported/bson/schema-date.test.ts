/* Ported from mongoose test/schema.date.test.js onto Typemo's DateCaster. */
import { describe, expect, test } from "bun:test";
import { DateCaster, SubdocumentCaster } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

const M = SubdocumentCaster.of({ x: DateCaster });

describe("SchemaDate", () => {
  // ported from mongoose test/schema.date.test.js:19 "accepts a Date"
  test("accepts a Date", () => {
    const x = M.cast({ x: new Date("2017-01-01") }).x;
    expect(x).toBeInstanceOf(Date);
    expect(x?.getUTCFullYear()).toBe(2017);
  });

  // ported from mongoose test/schema.date.test.js:25 "casts a date string to a string"
  test("casts a date string to a string", () => {
    // A date-only ISO string is UTC midnight (Mongoose reads it the same way via Date.parse).
    expect(M.cast({ x: "2017-10-01" }).x).toBeInstanceOf(Date);
    expect(M.cast({ x: "2017-10-01" }).x?.toISOString()).toBe("2017-10-01T00:00:00.000Z");
  });

  // ported from mongoose test/schema.date.test.js:30 "interprets a number as a unix timestamp"
  test("interprets a number as a unix timestamp (integer milliseconds only)", () => {
    expect(M.cast({ x: 2017 }).x?.getUTCFullYear()).toBe(1970);
    expect(castFailure(() => M.cast({ x: 2017.5 })).reason).toBe("integer");
  });

  // ported from mongoose test/schema.date.test.js:35 "attempts to interpret a string as a Date, not a timestamo (gh-5395)"
  test("attempts to interpret a string as a Date, not a timestamo (gh-5395) — divergence: '2017' is refused", () => {
    expect(castFailure(() => M.cast({ x: "2017" })).reason).toBe("format");
  });

  // ported from mongoose test/schema.date.test.js:40 "casts any object with a `.valueOf` function to a date"
  test("casts any object with a `.valueOf` function to a date — divergence: CastError", () => {
    const mockDate = Date.now();
    expect(castFailure(() => M.cast({ x: { valueOf: () => mockDate } })).reason).toBe("type");
  });

  // ported from mongoose test/schema.date.test.js:47 "casts string representation of unix timestamps (gh-6443)"
  test("casts string representation of unix timestamps (gh-6443) — divergence: CastError", () => {
    expect(castFailure(() => M.cast({ x: Date.now().toString() })).reason).toBe("format");
  });
});
