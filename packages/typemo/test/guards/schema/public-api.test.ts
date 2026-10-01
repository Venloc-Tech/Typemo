import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { NoAnyInPublicApi } from "@venloc/typemo-test-kit";

/*
 * No `any` in the public API (the schema exports included), and the schema, hooks, plugins and types sources
 * follow the style rules (classes, no prototype assignment, every `any` justified).
 */

const SOURCES = resolve(import.meta.dir, "../../../src");

/** Every `.ts` file under `dir`, recursively. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });

const L2 = [
  ...files(join(SOURCES, "schema")),
  ...files(join(SOURCES, "hooks")),
  ...files(join(SOURCES, "plugins")),
  ...files(join(SOURCES, "types")),
];

describe("guards", () => {
  test("no `any` in the public API of @venloc/typemo", () => {
    const report = NoAnyInPublicApi.assert({ entry: "packages/typemo/src/index.ts" });
    expect(report.exports.length).toBeGreaterThan(150);
  }, 60_000);

  test("no prototype legacy in the schema sources: no `.prototype.x =`, no `util.inherits`, no `function` without typed this", () => {
    for (const file of L2) {
      /* Comments are prose ("a naming function"), not code. */
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect({ file, hit: /\.prototype\.[A-Za-z_$]+\s*=/.test(text) }).toEqual({ file, hit: false });
      expect({ file, hit: text.includes("util.inherits") }).toEqual({ file, hit: false });
      for (const match of text.matchAll(/\bfunction\s*\(([^)]*)\)/g)) {
        expect({ file, fn: match[0], typedThis: (match[1] ?? "").trimStart().startsWith("this:") }).toEqual({
          file,
          fn: match[0],
          typedThis: true,
        });
      }
    }
  });

  test("every `any` in the schema sources carries a justification comment", () => {
    for (const file of L2) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (
          !/\bany\b/.test(
            line
              .replace(/\/\/.*$/, "")
              .replace(/\/\*.*\*\//, "")
              .replace(/"[^"]*"|`[^`]*`/g, ""),
          )
        )
          return;
        if (!/:\s*any\b|<any>|any\[\]|as any/.test(line)) return;
        const previous = lines[index - 1] ?? "";
        expect({
          file,
          line: index + 1,
          justified: /biome-ignore lint\/suspicious\/noExplicitAny: .+/.test(previous),
        }).toEqual({
          file,
          line: index + 1,
          justified: true,
        });
      });
    }
  });
});
