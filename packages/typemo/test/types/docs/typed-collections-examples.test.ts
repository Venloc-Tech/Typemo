import { describe, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expectNoTypeErrors, TsConfig } from "@venloc/typemo-test-kit";

/*
 * The examples of from-mongoose-to-typemo/architecture/typed-collections.md compile. Every ```ts block is
 * compiled on its own (its `@ts-expect-error` lines must still fail, or the block fails).
 */

const PAGE = "typed-collections.md";
const BLOCK = /```ts\n([\s\S]*?)```/g;
/* The architecture pages are local working material (not in the repository): checked when present. */
const FILE = resolve(TsConfig.repoRoot, "from-mongoose-to-typemo/architecture", PAGE);
const text = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const blocks = [...text.matchAll(BLOCK)].map((match) => match[1] ?? "");

describe(`from-mongoose-to-typemo/architecture/${PAGE}`, () => {
  test("has examples", () => {
    if (blocks.length < 4) throw new Error(`expected at least 4 examples, found ${blocks.length}`);
  });
  blocks.forEach((code, index) => {
    test(`example ${index + 1} compiles`, () => {
      expectNoTypeErrors(code);
    });
  });
});
