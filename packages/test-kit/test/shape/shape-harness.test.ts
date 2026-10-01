import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { expectShapeMatches, ShapeCompare } from "../../src/shape/shape-harness.ts";

/* Tests `ShapeCompare`: type vs runtime. Every rule has a negative case: the harness must catch the lie. */

/** The snippet the types are read from. */
const CODE = `
import type { ObjectId } from "mongodb";
export interface User {
  _id: ObjectId;
  name: string;
  age: number | null;
  nickname?: string;
  tags: string[];
  profile: { city: string; zip?: string };
  meta: Record<string, number>;
}
declare const loose: any;
declare const partlyLoose: { known: string; extra: any };
`;
/** Target for the `User` type. */
const user = { type: "User", code: CODE };

/**
 * A value that has the promised shape.
 *
 * @returns A new valid user document.
 */
const valid = (): Record<string, unknown> => ({
  _id: new ObjectId(),
  name: "Ann",
  age: null,
  tags: ["a"],
  profile: { city: "Riga" },
  meta: { visits: 3 },
});

/**
 * The mismatch messages of a value against a target.
 *
 * @param value - The value to check.
 * @param target - The type or expression to check against; defaults to `User`.
 * @returns One message per mismatch.
 */
const problems = (value: unknown, target: { type?: string; expr?: string } = user): string[] =>
  ShapeCompare.check({ code: CODE, ...target }, value).mismatches.map((m) => m.message);

describe("expectShapeMatches", () => {
  test("a value with the promised shape passes (optional keys may be absent)", () => {
    const result = expectShapeMatches(user, valid());
    expect(result.ok).toBe(true);
    expectShapeMatches(user, { ...valid(), nickname: "A", age: 30, profile: { city: "x", zip: "1" }, tags: [] });
  });

  test("unknown key in the data (the type under-reports)", () => {
    expect(problems({ ...valid(), password: "x" })).toEqual([
      "$.password: the data has this key (string), the type does not know it",
    ]);
  });

  test("required key missing from the data (the type over-promises)", () => {
    const { name: _name, ...withoutName } = valid();
    expect(problems(withoutName)).toEqual(["$.name: the type promises this key (string), the data lacks it"]);
  });

  test("null vs missing: `age: number | null` requires the key even when null", () => {
    const { age: _age, ...withoutAge } = valid();
    expect(problems(withoutAge)).toEqual(["$.age: the type promises this key (number | null), the data lacks it"]);
  });

  test("null vs missing: `nickname?: string` does not admit null", () => {
    expect(problems({ ...valid(), nickname: null })).toEqual(["$.nickname: the type says string, the data is null"]);
  });

  test("exactOptionalPropertyTypes: an own `undefined` is not an absent optional key", () => {
    expect(problems({ ...valid(), nickname: undefined })).toEqual([
      "$.nickname: the type says string, the data is undefined",
    ]);
  });

  test("wrong kinds: scalar, BSON class, array element, nested field, index signature", () => {
    expect(
      problems({
        ...valid(),
        _id: "65f0c0ffee0000000000000a",
        age: "30",
        tags: ["a", 1],
        profile: { city: 7 },
        meta: { visits: "3" },
      }),
    ).toEqual([
      "$._id: the type says ObjectId, the data is string",
      "$.age: the type says number | null, the data is string",
      "$.tags[]: the type says string, the data is number",
      "$.profile.city: the type says string, the data is number",
      "$.meta.visits: the type says number, the data is string",
    ]);
  });

  test("union with null: the object member's inner problems are reported", () => {
    expect(problems({ ...valid(), extra: 1 }, { expr: "null as User | null" })).toEqual([
      "$.extra: the data has this key (number), the type does not know it",
    ]);
    expect(problems(null, { expr: "null as User | null" })).toEqual([]);
  });

  test("`any` in the type is a mismatch by default (it proves nothing), allowed on request", () => {
    expect(problems({ x: 1 }, { expr: "loose" })).toEqual(["$: the type is any, nothing is checked here"]);
    expect(problems({ known: "a", extra: 1 }, { expr: "partlyLoose" })).toEqual([
      "$.extra: the type is any, nothing is checked here",
    ]);
    const allowed = ShapeCompare.check(
      { code: CODE, expr: "partlyLoose" },
      { known: "a", extra: 1 },
      { allowAny: true },
    );
    expect(allowed.ok).toBe(true);
  });

  test("requireOptional: an optional key of the type must be in the data too", () => {
    const filled = { ...valid(), nickname: "n", profile: { city: "c", zip: "z" } };
    expect(ShapeCompare.check(user, filled, { requireOptional: true }).ok).toBe(true);
    const { nickname: _, ...withoutNickname } = filled;
    expect(ShapeCompare.check(user, withoutNickname).ok).toBe(true);
    expect(
      ShapeCompare.check(user, withoutNickname, { requireOptional: true }).mismatches.map((m) => m.message),
    ).toEqual(["$.nickname: the type has this optional key (string), the data lacks it"]);
    expect(
      ShapeCompare.check(user, { ...filled, profile: { city: "c" } }, { requireOptional: true }).mismatches.map(
        (m) => m.message,
      ),
    ).toEqual(["$.profile.zip: the type has this optional key (string), the data lacks it"]);
  });

  test("the thrown report lists every problem plus both shapes", () => {
    let message = "";
    try {
      expectShapeMatches(user, { ...valid(), age: "old", password: "x" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.split("\n")).toEqual([
      "shape mismatch (2):",
      "  $.age: the type says number | null, the data is string",
      "  $.password: the data has this key (string), the type does not know it",
      expect.stringMatching(/^type: {4}\{ _id: ObjectId; age: number \| null; meta: \{ \[key: string\]: number \}; /),
      expect.stringMatching(
        /^runtime: \{ _id: ObjectId; age: string; meta: \{ visits: number \}; name: string; password: string; /,
      ),
    ]);
  });
});
