import { expect, test } from "bun:test";
import { TypeCheckRunner } from "@venloc/typemo-test-kit";

/* The BSON type tests also run inside `bun test` (a broken one fails with diagnostics). */

test("the BSON type tests compile cleanly", () => {
  const result = TypeCheckRunner.assertClean({ files: ["packages/typemo/test/types/bson/**/*.test-d.ts"] });
  expect(result.rootFiles).toContain("packages/typemo/test/types/bson/bson-table.test-d.ts");
});
