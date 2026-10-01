import { describe, expect, test } from "bun:test";
import { TypeCheckRunner } from "@venloc/typemo-test-kit";

/*
 * The change-stream helper type tests compiled on their own: the variance of the event aliases is measured by
 * the first file that compares two event types, so only a fresh program shows whether that measurement stays
 * within the instantiation limit (TS2589).
 */

const FILE = "packages/typemo/test/types/mechanisms/watch-helpers.test-d.ts";

describe("generic helpers over change streams", () => {
  test("compile on their own, without TS2589", () => {
    const result = TypeCheckRunner.assertClean({ files: [FILE] });
    expect(result.rootFiles).toContain(FILE);
  }, 120_000);
});
