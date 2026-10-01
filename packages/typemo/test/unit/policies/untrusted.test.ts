/*
 * `untrusted(value)` refuses a `$`-prefixed key at any depth inside request data. An extra line of defence only
 * (the JSDoc and L4-steps.md say so): input is validated by the application.
 */
import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { QueryError, StrictModeError, untrusted } from "../../../src/index.ts";

/** The path `untrusted(value)` refuses, or `undefined` when it accepts the value. */
const refusedAt = (value: unknown): string | undefined => {
  try {
    untrusted(value);
  } catch (error) {
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("sanitize");
    expect((error as Error).message).toMatch(/validate the input/);
    return (error as StrictModeError).path;
  }
  return undefined;
};

describe("untrusted(value)", () => {
  test("data without operators passes and is returned as is (same reference, not copied or mutated)", () => {
    const body = Object.freeze({ name: "Ann", tags: Object.freeze(["a"]), nested: Object.freeze({ price: 1 }) });
    expect(untrusted(body)).toBe(body);
    expect(untrusted("x")).toBe("x");
    expect(untrusted(null)).toBeNull();
    const id = new ObjectId();
    expect(untrusted({ id, at: new Date(0), re: /x/, bin: new Uint8Array([1]) }).id).toBe(id);
  });

  test("a $-key at any depth is refused, with its path", () => {
    expect(refusedAt({ $gt: "" })).toBe("$gt");
    expect(refusedAt({ name: { $ne: null } })).toBe("name.$ne");
    expect(refusedAt({ a: [{ b: { c: { $where: "1" } } }] })).toBe("a.0.b.c.$where");
    expect(refusedAt([{ ok: 1 }, { $or: [] }])).toBe("1.$or");
    expect(refusedAt(new Map([["$expr", 1]]))).toBe("$expr");
    expect(refusedAt({ m: new Map([["k", { $in: [] }]]) })).toBe("m.k.$in");
  });

  test("a key with $ elsewhere than the start is data", () => {
    expect(refusedAt({ price$: 1, a$b: { c: 1 } })).toBeUndefined();
  });

  test("a +key at any depth is refused, with its path and its own message", () => {
    expect(refusedAt({ "+passwordHash": true })).toBe("+passwordHash");
    expect(refusedAt({ name: 1, nested: { "+secret": 1 } })).toBe("nested.+secret");
    expect(refusedAt(new Map([["+secret", true]]))).toBe("+secret");
    expect(() => untrusted({ "+secret": true }, "projection")).toThrow(
      /would select a Hidden field; validate the input and build the projection yourself/,
    );
  });

  test("the error speaks about the place the value goes to; the default place is the filter", () => {
    const messageOf = (run: () => unknown): string => {
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(StrictModeError);
        return (error as Error).message;
      }
      throw new Error("expected a refusal");
    };
    expect(messageOf(() => untrusted({ $gt: "" }))).toBe(
      'untrusted value: "$gt" at "$gt" — an operator inside data from outside (query selector injection); validate the input and build the filter yourself [sanitize]',
    );
    expect(messageOf(() => untrusted({ $gt: "" }, "filter"))).toBe(messageOf(() => untrusted({ $gt: "" })));
    expect(messageOf(() => untrusted({ bio: { $rename: "role" } }, "update"))).toBe(
      'untrusted value: "$rename" at "bio.$rename" — an operator inside data from outside would change what the update does (update operator injection); validate the input and build the update yourself [sanitize]',
    );
    expect(messageOf(() => untrusted({ total: { $sum: 1 } }, "projection"))).toBe(
      'untrusted value: "$sum" at "total.$sum" — an operator inside data from outside would turn the projection into a computed expression; validate the input and build the projection yourself [sanitize]',
    );
    expect(messageOf(() => untrusted({ "+secret": 1 }))).toBe(
      'untrusted value: "+secret" at "+secret" — a "+path" key inside data from outside is not a field name (in a projection it selects a Hidden field); validate the input and build the filter yourself [sanitize]',
    );
    expect(messageOf(() => untrusted({ "+secret": 1 }, "update"))).toContain("build the update yourself");
  });

  test("an unknown place (a caller without types) is a QueryError, even for a harmless value", () => {
    expect(() => untrusted("x", "sort" as never)).toThrow(QueryError);
    expect(() => untrusted("x", "sort" as never)).toThrow(
      'place must be "filter", "update" or "projection", got string "sort"',
    );
  });

  test("a + elsewhere than the start of a key, and + inside values, are data", () => {
    expect(refusedAt({ "a+b": 1, phone: "+15550100", list: ["+x"] })).toBeUndefined();
  });

  test("cycles do not loop", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(untrusted(cyclic)).toBe(cyclic);
  });
});
