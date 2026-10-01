/* Tests `TypeCheckRunner`: type tests run inside `bun test`, and a broken one fails with readable diagnostics. */
import { describe, expect, test } from "bun:test";
import { TypeCheckRunner } from "../../src/types/type-check-runner.ts";

describe("TypeCheckRunner", () => {
  test("the test-kit type tests compile cleanly", () => {
    const result = TypeCheckRunner.assertClean({ files: ["packages/test-kit/test/types/**/*.test-d.ts"] });
    expect(result.rootFiles).toContain("packages/test-kit/test/types/type-assertions.test-d.ts");
  });

  /* The whole type-test project is checked in-process: about 5 s (2.45M instantiations), above
     bun's default 5 s test timeout. */
  test(
    "the whole `test:types` project (tsconfig.test.json) compiles cleanly",
    () => {
      const result = TypeCheckRunner.run();
      if (!result.ok) throw new Error(result.text);
      expect(result.rootFiles.length).toBeGreaterThan(0);
    },
    { timeout: 30_000 },
  );

  test("a failing assertion is reported with file, line, code and the assertion payload", () => {
    const result = TypeCheckRunner.run({
      files: [],
      sources: {
        "packages/test-kit/test/types/__virtual-broken__.ts": [
          'import type { AssertEqual, Expect } from "../../src/types/type-assertions.ts";',
          "export type Broken = Expect<AssertEqual<{ a: string }, { a: number }>>;",
        ].join("\n"),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.file).toBe("packages/test-kit/test/types/__virtual-broken__.ts");
    expect(diagnostic?.line).toBe(2);
    expect(diagnostic?.code).toBe(2344);
    expect(diagnostic?.message).toContain("types are not identical");
    expect(result.text).toContain("__virtual-broken__.ts(2,");
    expect(() =>
      TypeCheckRunner.assertClean({
        files: [],
        sources: { "packages/test-kit/test/types/__v2__.ts": "export const x: number = 'a';" },
      }),
    ).toThrow(/TS2322.*Type 'string' is not assignable to type 'number'/);
  });

  test("an unused @ts-expect-error is an error (a negative test that stopped failing)", () => {
    const result = TypeCheckRunner.run({
      files: [],
      sources: {
        "packages/test-kit/test/types/__v3__.ts":
          "// @ts-expect-error nothing fails here\nexport const ok: number = 1;",
      },
    });
    expect(result.diagnostics.map((d) => d.code)).toEqual([2578]);
  });
});
