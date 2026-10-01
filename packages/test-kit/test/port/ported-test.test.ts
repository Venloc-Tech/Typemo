/* Tests `PortedTest`: the citation header and index row formats. */
import { expect, test } from "bun:test";
import { PortedTest } from "../../src/port/ported-test.ts";

test("header() renders the canonical citation format", () => {
  const header = PortedTest.header({
    file: "test/model.test.js",
    line: 7761,
    title: "saves new documents",
  });

  expect(header).toBe('ported from mongoose test/model.test.js:7761 "saves new documents"');
});

test("header() appends a history.yaml reference when given one", () => {
  const header = PortedTest.header({
    file: "test/schema.test.js",
    line: 42,
    title: "removes subpaths",
    historyRef: "H001",
  });

  expect(header).toBe('ported from mongoose test/schema.test.js:42 "removes subpaths" (history: H001)');
});

test("indexRow() renders a Markdown table row matching INDEX.md's header", () => {
  const row = PortedTest.indexRow({
    source: { file: "test/model.test.js", line: 7761, title: "saves new documents" },
    portedFile: "packages/typemo/test/ported/demo/insert-and-find.test.ts",
    status: "pass",
  });

  expect(row).toBe(
    '| test/model.test.js:7761 "saves new documents" | packages/typemo/test/ported/demo/insert-and-find.test.ts | pass |',
  );
});
