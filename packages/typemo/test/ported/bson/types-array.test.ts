/* Ported from mongoose test/types.array.test.js (castNonArrays) onto Typemo's ArrayCaster. */
import { describe, expect, test } from "bun:test";
import { ArrayCaster, StringCaster, SubdocumentCaster } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

describe("types.array", () => {
  // ported from mongoose test/types.array.test.js:1054 "castNonArrays (gh-7371) (gh-7479)"
  test("castNonArrays (gh-7371) (gh-7479) — divergence: no castNonArrays option at all", () => {
    const Model = SubdocumentCaster.of({
      arr: ArrayCaster.of(StringCaster),
      docArr: ArrayCaster.of(SubdocumentCaster.of({ name: StringCaster })),
    });
    // Same as Mongoose with castNonArrays: false: scalars are cast errors.
    expect(castFailure(() => Model.cast({ arr: "fail" })).path).toBe("arr");
    expect(castFailure(() => Model.cast({ docArr: { name: "fail" } })).path).toBe("docArr");
    expect(Model.cast({ arr: ["good"] }).arr).toEqual(["good"]);
    // Mongoose's per-path `castNonArrays: true` (wrap a scalar into [scalar]) has no equivalent: Typemo never wraps.
  });
});
