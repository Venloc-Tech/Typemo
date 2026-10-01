import { describe, expect, test } from "bun:test";
import { TypeCheckRunner } from "@venloc/typemo-test-kit";

/*
 * The collection type tests also run inside `bun test`, in the user configurations that change their meaning:
 * `emitDecoratorMetadata` off and `exactOptionalPropertyTypes` off.
 */

const FILES = ["packages/typemo/test/types/collections/**/*.test-d.ts"];

describe("collection type tests", () => {
  test.each([
    ["the repository configuration", {}],
    ["emitDecoratorMetadata off", { emitDecoratorMetadata: false }],
    ["exactOptionalPropertyTypes off", { exactOptionalPropertyTypes: false }],
  ] as const)(
    "compile cleanly with %s",
    (_name, compilerOptions) => {
      const result = TypeCheckRunner.assertClean({ files: FILES, compilerOptions });
      expect(result.rootFiles).toContain("packages/typemo/test/types/collections/collections.test-d.ts");
    },
    120_000,
  );
});
