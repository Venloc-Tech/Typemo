/*
 * The compiled tree of a `.mask()` spec is cached only for a FROZEN spec object; a mutable spec reused after a
 * change is compiled again — a key added later is never ignored.
 */
import { describe, expect, test } from "bun:test";
import { ResponseMask } from "../../../src/query/response-mask.ts";

const ROW = { name: "Ann", email: "ann@x.test", phone: "123" };

describe("ResponseMask.compile cache", () => {
  test("a mutable spec reused after adding a key masks the new key too", () => {
    const spec: Record<string, unknown> = { email: "mask" };
    expect(ResponseMask.apply(ResponseMask.compile(spec), ROW, "User")).toEqual({ ...ROW, email: "?" });
    spec.phone = "mask";
    expect(ResponseMask.apply(ResponseMask.compile(spec), ROW, "User")).toEqual({ ...ROW, email: "?", phone: "?" });
    /* Not cached: every call builds its own tree. */
    expect(ResponseMask.compile(spec)).not.toBe(ResponseMask.compile(spec));
  });

  test("a frozen spec is compiled once and never mutated by Typemo", () => {
    const spec = Object.freeze({ email: "mask" });
    const tree = ResponseMask.compile(spec);
    expect(ResponseMask.compile(spec)).toBe(tree);
    expect(spec).toEqual({ email: "mask" });
  });

  test("the input spec is not frozen by compile", () => {
    const spec = { email: "mask" };
    ResponseMask.compile(spec);
    expect(Object.isFrozen(spec)).toBe(false);
  });
});
