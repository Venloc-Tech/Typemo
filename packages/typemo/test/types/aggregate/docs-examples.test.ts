import { describe, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expectNoTypeErrors, TsConfig } from "@venloc/typemo-test-kit";

/*
 * The examples of from-mongoose-to-typemo/architecture/L3-aggregate.md compile. Every ```ts block is compiled on
 * its own (its `@ts-expect-error` lines must still fail, or the block fails).
 */

/* The architecture pages are local working material (not in the repository): checked when present. */
const PAGE = resolve(TsConfig.repoRoot, "from-mongoose-to-typemo/architecture/L3-aggregate.md");
const text = existsSync(PAGE) ? readFileSync(PAGE, "utf8") : "";
const blocks = [...text.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");

describe("from-mongoose-to-typemo/architecture/L3-aggregate.md", () => {
  blocks.forEach((code, index) => {
    test(`example ${index + 1} compiles`, () => {
      expectNoTypeErrors(code);
    });
  });
});
