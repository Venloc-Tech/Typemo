import { describe, expect, test } from "bun:test";
import { TypeCheckRunner } from "@venloc/typemo-test-kit";

/*
 * Operation-step type tests (rows without Hidden fields, validation contexts), with `emitDecoratorMetadata` on
 * and off (the fixtures are decorated entities).
 */

const FILES = ["packages/typemo/test/types/steps/**/*.test-d.ts"];

describe("operation step type tests", () => {
  test.each([
    ["emitDecoratorMetadata on", { emitDecoratorMetadata: true }],
    ["emitDecoratorMetadata off", { emitDecoratorMetadata: false }],
  ] as const)(
    "compile cleanly with %s",
    (_name, compilerOptions) => {
      const result = TypeCheckRunner.assertClean({ files: FILES, compilerOptions });
      expect(result.rootFiles).toContain("packages/typemo/test/types/steps/hidden-rows.test-d.ts");
    },
    120_000,
  );
});
