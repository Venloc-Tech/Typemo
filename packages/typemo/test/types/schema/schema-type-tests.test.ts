import { describe, expect, test } from "bun:test";
import { TypeCheckRunner } from "@venloc/typemo-test-kit";

/*
 * The schema type tests also run inside `bun test`, in both user configurations — with `emitDecoratorMetadata`
 * on (tsconfig.test.json) and off — and with both `useDefineForClassFields`.
 */

const FILES = ["packages/typemo/test/types/schema/**/*.test-d.ts"];

describe("schema type tests", () => {
  test.each([
    ["emitDecoratorMetadata on", { emitDecoratorMetadata: true }],
    ["emitDecoratorMetadata off", { emitDecoratorMetadata: false }],
    ["useDefineForClassFields on", { useDefineForClassFields: true }],
  ] as const)(
    "compile cleanly with %s",
    (_name, compilerOptions) => {
      const result = TypeCheckRunner.assertClean({ files: FILES, compilerOptions });
      expect(result.rootFiles).toContain("packages/typemo/test/types/schema/decorators.test-d.ts");
    },
    60_000,
  );
});
