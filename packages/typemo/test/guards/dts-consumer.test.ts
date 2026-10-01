import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { DeclarationBuild, type DeclarationBuildResult, TsConfig, TypeCheckRunner } from "@venloc/typemo-test-kit";

/*
 * The repository's type tests resolve `@venloc/typemo` to its SOURCES, but a user compiles against the EMITTED
 * declarations — and two bugs lived only there (TS2589 on `Pipeline.from(X).match(…)`/`.group(…)` and on
 * `Model.watch`'s `WatchRows`: the variance of `MatchFilter` was measured structurally through the whole filter
 * grammar). This guard builds the declarations the way they are published and compiles consumer code through
 * them — with `skipLibCheck: false` too, so the declarations themselves must check — and fails on any diagnostic.
 */

const OUT = resolve(TsConfig.repoRoot, "packages/typemo/node_modules/.cache/typemo-dts-guard");
let build: DeclarationBuildResult;

const through = (index: string) => ({
  "@venloc/typemo": [index],
  "@venloc/typemo/testing": [resolve(OUT, "testing/index.d.ts")],
});

beforeAll(() => {
  build = DeclarationBuild.build("packages/typemo", OUT);
});

afterAll(() => {
  rmSync(OUT, { recursive: true, force: true });
});

describe("guards: consumers of the built declarations (.d.ts)", () => {
  test("the declarations of @venloc/typemo build without diagnostics", () => {
    expect(build.text).toBe("");
    expect(build.ok).toBe(true);
  });

  test.each([
    ["skipLibCheck: true (the usual user setting)", true],
    ["skipLibCheck: false (the declarations are checked too)", false],
  ] as const)(
    "a consumer project compiles through them — %s",
    (_name, skipLibCheck) => {
      const result = TypeCheckRunner.run({
        files: [
          "packages/typemo/test/fixtures/dts-consumer/consumer.ts",
          "packages/test-kit/fixtures/dense-graph/usage/all.ts",
          "packages/test-kit/fixtures/dense-graph/usage/then-stress.ts",
        ],
        compilerOptions: { skipLibCheck, paths: through(build.index) },
      });
      expect(result.text).toBe("");
      /* Really through the declarations, not the sources. */
      expect(result.rootFiles.length).toBe(3);
    },
    120_000,
  );
});
