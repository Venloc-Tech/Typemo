import { expect, test } from "bun:test";
import { TypeCheckRunner } from "@venloc/typemo-test-kit";

// The Sentry adapter's type tests also run inside `bun test` (a broken one fails with
// diagnostics), the same way every other package's `.test-d.ts` files do.

test("the sentry type tests compile cleanly", () => {
  const result = TypeCheckRunner.assertClean({ files: ["integrations/sentry/test/types/**/*.test-d.ts"] });
  expect(result.rootFiles).toContain("integrations/sentry/test/types/sentry-options.test-d.ts");
});
