import { expect, test } from "bun:test";
import { TypeCheckRunner } from "@venloc/typemo-test-kit";

// The NestJS package's type tests also run inside `bun test` (a broken one fails with diagnostics).

test("the nestjs type tests compile cleanly", () => {
  const result = TypeCheckRunner.assertClean({ files: ["integrations/nestjs/test/types/**/*.test-d.ts"] });
  expect(result.rootFiles).toContain("integrations/nestjs/test/types/nestjs-api.test-d.ts");
}, 120_000);
