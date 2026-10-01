import { describe, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expectNoTypeErrors, TsConfig } from "@venloc/typemo-test-kit";

/*
 * The examples of the pages in from-mongoose-to-typemo/architecture compile. Every ```ts block is compiled on its
 * own (its `@ts-expect-error` lines must still fail, or the block fails). EVERY page of the directory is checked
 * (a new page is checked without being listed; a page without `ts` blocks passes trivially). L3-aggregate and
 * typed-collections also have their own tests.
 */

/* The architecture pages are local working material (not in the repository): checked when they are present. */
const DIR = resolve(TsConfig.repoRoot, "from-mongoose-to-typemo/architecture");
const PAGES = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((name) => name.endsWith(".md"))
      .sort()
  : [];
/*
 * Pages describe internals too; their examples import internal names from the pseudo specifier
 * `@venloc/typemo/internal` (not in the package `exports`), mapped here to `src/internal.ts`.
 */
const INTERNAL = resolve(TsConfig.repoRoot, "packages/typemo/src/internal.ts");
const BLOCK = /```ts\n([\s\S]*?)```/g;

for (const page of PAGES) {
  const text = readFileSync(resolve(TsConfig.repoRoot, "from-mongoose-to-typemo/architecture", page), "utf8");
  const blocks = [...text.matchAll(BLOCK)].map((match) => match[1] ?? "");
  describe(`from-mongoose-to-typemo/architecture/${page}`, () => {
    blocks.forEach((code, index) => {
      test(`example ${index + 1} compiles`, () => {
        expectNoTypeErrors(code.replaceAll('"@venloc/typemo/internal"', JSON.stringify(INTERNAL)));
      });
    });
  });
}
