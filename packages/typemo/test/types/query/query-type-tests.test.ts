import { describe, expect, test } from "bun:test";
import { TypeCheckRunner } from "@venloc/typemo-test-kit";

/*
 * The query type tests also run inside `bun test`, in the user configurations that change their meaning:
 * `emitDecoratorMetadata` off, and `exactOptionalPropertyTypes` OFF — without it an optional property accepts
 * `undefined`, so the rule "undefined is never a value" rests on the generic checks of the filter/update
 * (`path-check.ts`) alone.
 */

const FILES = [
  "packages/typemo/test/types/query/**/*.test-d.ts",
  "packages/typemo/test/types/schema/embedded-discriminators.test-d.ts",
];

describe("query type tests", () => {
  test.each([
    ["the repository configuration", {}],
    ["emitDecoratorMetadata off", { emitDecoratorMetadata: false }],
    ["exactOptionalPropertyTypes off", { exactOptionalPropertyTypes: false }],
  ] as const)(
    "compile cleanly with %s",
    (_name, compilerOptions) => {
      const result = TypeCheckRunner.assertClean({ files: FILES, compilerOptions });
      expect(result.rootFiles).toContain("packages/typemo/test/types/query/filter.test-d.ts");
    },
    120_000,
  );
});
