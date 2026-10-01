import { describe, expect, test } from "bun:test";
import {
  BsonGuards,
  CastError,
  ConfigurationError,
  DateCaster,
  Int32Caster,
  NumberCaster,
  StringCaster,
  SubdocumentCaster,
  UnionCaster,
} from "../../../src/internal.ts";

/*
 * A union member is chosen by a type guard or a discriminator; exactly one member must claim the value; the
 * selected member's validators (and only its) run.
 */

/** Runs `run` and returns the `CastError` it throws; anything else fails the test. */
const failure = (run: () => unknown): CastError => {
  try {
    run();
  } catch (error) {
    if (error instanceof CastError) return error;
    throw error;
  }
  throw new Error("expected a CastError");
};

/** A type guard for string values. */
const isString = (value: unknown): boolean => typeof value === "string";
/** A type guard for number values. */
const isNumber = (value: unknown): boolean => typeof value === "number";

describe("UnionCaster.byGuard", () => {
  const union = UnionCaster.byGuard(
    UnionCaster.member("text", isString, StringCaster, [(v) => v.length <= 3 || "at most 3 characters"]),
    UnionCaster.member("count", isNumber, Int32Caster, [(v) => v >= 0 || "must not be negative"]),
  );

  test("the member claimed by its guard casts the value; the type is kept", () => {
    expect(union.cast("abc")).toBe("abc");
    expect(union.cast(5)).toBe(5);
    expect(union.select("x")).toBe("text");
    expect(union.select(1)).toBe("count");
    expect(union.members).toEqual(["text", "count"]);
    expect(union.expected).toBe("string | Int32");
  });

  test("a numeric string stays a string (Mongoose [Number, String] + '5' order games do not exist)", () => {
    expect(union.cast("5")).toBe("5");
  });

  test("no member claims the value → union-no-match; null/undefined keep their own reasons", () => {
    const error = failure(() => union.cast(true, "value"));
    expect(error.reason).toBe("union-no-match");
    expect(error.path).toBe("value");
    expect(error.message).toContain("text, count");
    expect(failure(() => union.cast(null)).reason).toBe("null");
    expect(failure(() => union.cast(undefined)).reason).toBe("undefined");
  });

  test("the selected member's caster errors are not swallowed", () => {
    expect(failure(() => union.cast(1.5)).reason).toBe("integer");
  });

  test("two members claiming the same value → union-ambiguous (no silent first-wins)", () => {
    const ambiguous = UnionCaster.byGuard(
      UnionCaster.member("int", isNumber, Int32Caster),
      UnionCaster.member("number", isNumber, NumberCaster),
    );
    const error = failure(() => ambiguous.cast(1));
    expect(error.reason).toBe("union-ambiguous");
    expect(error.message).toContain('"int", "number"');
  });

  test("validate runs the validators of the selected member only", () => {
    expect(union.validate("ab")).toEqual([]);
    expect(union.validate("abcd", "value")).toEqual([
      { path: "value", member: "text", message: "at most 3 characters", value: "abcd" },
    ]);
    expect(union.validate(-1)).toEqual([{ path: "", member: "count", message: "must not be negative", value: -1 }]);
  });

  test("encode uses the member of the hydrated value", () => {
    expect((union.encode(5) as { _bsontype: string })._bsontype).toBe("Int32");
    expect(union.encode("a")).toBe("a");
  });

  test("a guard on a native type only: an ISO string is not claimed by a Date member", () => {
    const when = UnionCaster.byGuard(UnionCaster.member("date", BsonGuards.isDate, DateCaster));
    expect(failure(() => when.cast("2020-01-02T03:04:05Z")).reason).toBe("union-no-match");
  });

  test("definition errors", () => {
    expect(() => UnionCaster.byGuard()).toThrow(ConfigurationError);
    expect(() =>
      UnionCaster.byGuard(
        UnionCaster.member("a", isString, StringCaster),
        UnionCaster.member("a", isNumber, NumberCaster),
      ),
    ).toThrow(ConfigurationError);
  });
});

describe("UnionCaster.byDiscriminator", () => {
  const shape = UnionCaster.byDiscriminator(
    "kind",
    {
      circle: SubdocumentCaster.of({ kind: StringCaster, radius: NumberCaster }),
      square: SubdocumentCaster.of({ kind: StringCaster, side: NumberCaster }),
    },
    { circle: [(v) => (v.radius ?? 0) > 0 || "radius must be positive"] },
  );

  test("the discriminator value picks the member", () => {
    expect(shape.cast({ kind: "circle", radius: 2 })).toEqual({ kind: "circle", radius: 2 });
    expect(shape.select({ kind: "square", side: 1 })).toBe("square");
  });

  test("fields of another member are unknown to the selected one (no first-subdocument-wins)", () => {
    const error = failure(() => shape.cast({ kind: "circle", side: 2 }, "shape"));
    expect(error.reason).toBe("unknown-key");
    expect(error.path).toBe("shape.side");
  });

  test("a missing or unknown discriminator → union-no-match naming the allowed values", () => {
    const missing = failure(() => shape.cast({ radius: 1 }));
    expect(missing.reason).toBe("union-no-match");
    expect(missing.message).toContain('"kind" must be one of "circle", "square"');
    expect(failure(() => shape.cast({ kind: "triangle" })).reason).toBe("union-no-match");
    expect(failure(() => shape.cast("circle")).reason).toBe("union-no-match");
  });

  test("validators of the selected member run (gh-15732: they were bypassed in Mongoose)", () => {
    expect(shape.validate(shape.cast({ kind: "circle", radius: -1 }), "shape")).toEqual([
      { path: "shape", member: "circle", message: "radius must be positive", value: { kind: "circle", radius: -1 } },
    ]);
    expect(shape.validate(shape.cast({ kind: "square", side: -1 }))).toEqual([]);
  });
});
