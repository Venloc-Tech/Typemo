import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Style rules for the storage sources (collections, change streams, pagination, testing, index sync): classes
 * only, typed `this`, no `any`, helpers as static classes (no loose exported `function` declarations).
 */

const SOURCES = resolve(import.meta.dir, "../../../src");

/** Every `.ts` file under `dir`, recursively. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });

const OWN = [
  ...["collections", "change-streams", "pagination", "testing"].flatMap((area) => files(join(SOURCES, area))),
  join(SOURCES, "model/model-indexes.ts"),
];

/** The source of `file` without comments. */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

describe("guards: storage sources", () => {
  test("no prototype legacy, no untyped `this`, no function declarations", () => {
    for (const file of OWN) {
      const text = code(file);
      expect({ file, hit: /\.prototype\.[A-Za-z_$]+\s*=/.test(text) || text.includes("util.inherits") }).toEqual({
        file,
        hit: false,
      });
      expect({ file, declarations: /^\s*(export\s+)?(async\s+)?function\b/m.test(text) }).toEqual({
        file,
        declarations: false,
      });
      for (const match of text.matchAll(/\bfunction\s*\(([^)]*)\)/g)) {
        expect({ file, typedThis: (match[1] ?? "").trimStart().startsWith("this:") }).toEqual({
          file,
          typedThis: true,
        });
      }
    }
  });

  test("no `any`", () => {
    for (const file of OWN) {
      const text = code(file).replace(/"[^"\n]*"|`[^`]*`/g, "");
      expect({ file, any: /:\s*any\b|<any>|any\[\]|as any\b/.test(text) }).toEqual({ file, any: false });
    }
  });
});
