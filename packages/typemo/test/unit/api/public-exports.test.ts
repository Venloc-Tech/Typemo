/*
 * The public API of `@venloc/typemo` is pinned. Any added, removed or value↔type-changed export of
 * `src/index.ts` shows up as a diff of the snapshot; update it only on a deliberate API change
 * (`bun test test/unit/api --update-snapshots`) and mention it in the report.
 */
import { describe, expect, test } from "bun:test";
import { PublicExports } from "@venloc/typemo-test-kit";

describe("public API of @venloc/typemo", () => {
  const exports = PublicExports.list({ entry: "packages/typemo/src/index.ts" });

  test("export list snapshot (sorted; `value` or `type`)", () => {
    expect(exports.join("\n")).toMatchSnapshot();
  });

  test("the operation pipeline and its steps are not public (policy bypass, 11.7.8)", () => {
    const names = new Set(exports.map((line) => line.slice(line.indexOf(" ") + 1)));
    for (const name of [
      "OperationPipeline",
      "PassThroughStep",
      "StandardPipeline",
      "DriverExecutor",
      "ConnectionInternals",
      "CastStep",
      "PolicyStep",
      "TenantPolicy",
      "SoftDeletePolicy",
      "HiddenPolicy",
      "SanitizePolicy",
      "StrictPathPolicy",
      "SchemaCompiler",
    ]) {
      expect(names.has(name)).toBe(false);
    }
  });

  test("a connection has no public pipeline getter or setter", async () => {
    const { Connection } = await import("../../../src/index.ts");
    const members = Object.getOwnPropertyNames(Connection.prototype);
    expect(members).not.toContain("pipeline");
    expect(members).not.toContain("usePipeline");
  });
});
