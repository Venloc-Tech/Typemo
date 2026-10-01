import { describe, expect, test } from "bun:test";
import { TypeCheckRunner } from "@venloc/typemo-test-kit";

/*
 * The aggregation type tests (expressions, stages, kinds) also run inside `bun test`, with
 * `emitDecoratorMetadata` on and off (the fixtures are decorated entities).
 */

const FILES = ["packages/typemo/test/types/aggregate/**/*.test-d.ts"];

describe("aggregation type tests", () => {
  test.each([
    ["emitDecoratorMetadata on", { emitDecoratorMetadata: true }],
    ["emitDecoratorMetadata off", { emitDecoratorMetadata: false }],
  ] as const)(
    "compile cleanly with %s",
    (_name, compilerOptions) => {
      const result = TypeCheckRunner.assertClean({ files: FILES, compilerOptions });
      expect(result.rootFiles).toContain("packages/typemo/test/types/aggregate/stages.test-d.ts");
    },
    120_000,
  );
});
