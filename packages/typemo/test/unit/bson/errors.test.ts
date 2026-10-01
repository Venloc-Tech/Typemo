import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import { CastError, ConfigurationError, Int32Caster, TypemoError } from "../../../src/internal.ts";

/* The base of the error hierarchy. */

/** A `CastError` produced by a real caster failure. */
const castError = (): CastError => {
  try {
    Int32Caster.cast(2 ** 31, "stats.visits");
  } catch (error) {
    return error as CastError;
  }
  throw new Error("expected a CastError");
};

describe("TypemoError hierarchy", () => {
  test("CastError and ConfigurationError are TypemoErrors and Errors, with their names", () => {
    const error = castError();
    expect(error).toBeInstanceOf(CastError);
    expect(error).toBeInstanceOf(TypemoError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CastError");
    const configuration = new ConfigurationError("bad");
    expect(configuration).toBeInstanceOf(TypemoError);
    expect(configuration.name).toBe("ConfigurationError");
    expect(new TypemoError("x").name).toBe("TypemoError");
  });

  test("cause is kept when given and absent otherwise", () => {
    const original = new Error("driver");
    expect(new TypemoError("x", { cause: original }).cause).toBe(original);
    expect("cause" in new TypemoError("x")).toBe(false);
  });
});

describe("CastError", () => {
  test("carries path, value, expected, reason and detail; the message repeats them (the reason is in the message)", () => {
    const error = castError();
    expect(error.path).toBe("stats.visits");
    expect(error.value).toBe(2 ** 31);
    expect(error.expected).toBe("Int32");
    expect(error.reason).toBe("range");
    expect(error.message).toBe(
      'Cast to Int32 failed at path "stats.visits" for 2147483648 (number): out of the Int32 range [-2^31, 2^31 - 1] [range]',
    );
  });

  test("describe keeps messages short for any value", () => {
    expect(CastError.describe("x".repeat(100))).toBe(`${JSON.stringify(`${"x".repeat(57)}...`)} (string)`);
    expect(CastError.describe(-0)).toBe("-0 (number)");
    expect(CastError.describe(5n)).toBe("5n (bigint)");
    expect(CastError.describe([1, 2, 3])).toBe("[array of 3]");
    expect(CastError.describe(new Map())).toBe("a Map");
    expect(CastError.describe({})).toBe("an object");
    expect(CastError.describe(Object.create(null))).toBe("an object");
    expect(CastError.describe(Symbol("s"))).toBe("a symbol");
  });

  test("toJSON leaves the value out", () => {
    expect(JSON.parse(JSON.stringify(castError()))).toEqual({
      name: "CastError",
      message: castError().message,
      path: "stats.visits",
      expected: "Int32",
      reason: "range",
    });
  });

  test("inspect output stays compact (no model/schema reference inside)", () => {
    expect(inspect(castError()).length).toBeLessThan(2_000);
  });
});
