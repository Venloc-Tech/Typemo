/* Tests the `any` guard. Negative cases use a fixture that leaks `any` on purpose. */
import { describe, expect, test } from "bun:test";
import { NoAnyInPublicApi } from "../../src/guards/no-any-in-public-api.ts";

/** Repo-relative path of the fixture that leaks `any`. */
const FIXTURE = "packages/test-kit/test/guards/fixtures/leaky-api.ts";

describe("NoAnyInPublicApi", () => {
  test("the core entry (@venloc/typemo) has no `any`", () => {
    const report = NoAnyInPublicApi.assert({ entry: "packages/typemo/src/index.ts" });
    expect(report.exports).toContain("VERSION");
  });

  test("the test-kit type/hover/shape API has no `any`", () => {
    const report = NoAnyInPublicApi.assert({ entry: "packages/test-kit/src/type-kit.ts" });
    expect(report.exports).toContain("TypeProbe");
    expect(report.exports).toContain("expectShapeMatches");
  });

  test("finds explicit, inferred, nested and hidden `any` in a leaky API", () => {
    const report = NoAnyInPublicApi.scan({ entry: FIXTURE });
    const paths = [...new Set(report.findings.map((f) => f.path))];
    expect(paths.sort()).toEqual(
      [
        "parse()" /* inferred from JSON.parse */,
        "Options.loose",
        "Options.nested.deep<0>" /* type argument of a library type */,
        "Handler(value)",
        "Exposed" /* `any` in a conditional branch of a non-exported helper (syntax scan) */,
        "Service.data<1>" /* second type argument of Record<string, any> */,
        "wrapped<0>",
      ].sort(),
    );
    expect(report.findings.find((f) => f.path === "Exposed")?.via).toBe("syntax");
    expect(report.findings.find((f) => f.path === "parse()")?.via).toBe("type");
    expect(report.findings.every((f) => f.file === FIXTURE && f.line > 0)).toBe(true);
  });

  test("private members and implementation bodies are not reported", () => {
    const report = NoAnyInPublicApi.scan({ entry: FIXTURE });
    const paths = report.findings.map((f) => f.path);
    expect(paths.some((p) => p.includes("secret"))).toBe(false);
    expect(paths.some((p) => p.startsWith("internalAny"))).toBe(false);
    expect(paths.some((p) => p.startsWith("clean"))).toBe(false);
    expect(paths.some((p) => p.startsWith("Options.clean"))).toBe(false);
  });

  test("allowlist moves findings to `allowed` and reports stale entries", () => {
    const report = NoAnyInPublicApi.scan({
      entry: FIXTURE,
      allowlist: [
        { path: "Handler(value)", reason: "fixture: callback accepts anything" },
        { path: /^Options\./, reason: "fixture: legacy options bag" },
        { path: "Gone.prop", reason: "fixture: stale entry" },
      ],
    });
    const paths = report.findings.map((f) => f.path);
    expect(paths).not.toContain("Handler(value)");
    expect(paths.some((p) => p.startsWith("Options."))).toBe(false);
    expect(report.allowed.map((f) => f.path)).toContain("Handler(value)");
    expect(report.unusedAllowEntries.map((e) => String(e.path))).toEqual(["Gone.prop"]);
  });

  test("assert() throws a readable report", () => {
    expect(() => NoAnyInPublicApi.assert({ entry: FIXTURE })).toThrow(
      /'any' in the public API of packages\/test-kit\/test\/guards\/fixtures\/leaky-api\.ts[\s\S]*Handler\(value\)\s+\[type\]/,
    );
  });
});
