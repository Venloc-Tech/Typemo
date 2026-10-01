import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * The query builders and the query types follow the style rules — classes only (no prototype assignment, no
 * `util.inherits`), `function` only with a typed `this`, no `any` at all (the public no-`any` guard over
 * `index.ts` is `bun run check:any` and the schema guard test), and no builder mutates its state (every
 * `this.state` is frozen at construction).
 */

const SOURCES = resolve(import.meta.dir, "../../../src");

/** Every `.ts` file under `dir`, recursively. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });

const L3 = [...files(join(SOURCES, "query")), ...files(join(SOURCES, "types")), join(SOURCES, "errors/query-error.ts")];

/** The source of `file` without comments. */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

describe("guards: query sources", () => {
  test("no prototype legacy, no untyped `this`", () => {
    for (const file of L3) {
      const text = code(file);
      expect({ file, hit: /\.prototype\.[A-Za-z_$]+\s*=/.test(text) || text.includes("util.inherits") }).toEqual({
        file,
        hit: false,
      });
      for (const match of text.matchAll(/\bfunction\s*\(([^)]*)\)/g)) {
        expect({ file, typedThis: (match[1] ?? "").trimStart().startsWith("this:") }).toEqual({
          file,
          typedThis: true,
        });
      }
    }
  });

  test("no `any` in the query sources (not even justified: they need none)", () => {
    for (const file of L3) {
      const text = code(file).replace(/"[^"\n]*"|`[^`]*`/g, "");
      expect({ file, any: /:\s*any\b|<any>|any\[\]|as any\b/.test(text) }).toEqual({ file, any: false });
    }
  });

  test("builders never assign to their state after construction", () => {
    for (const file of files(join(SOURCES, "query"))) {
      const text = code(file);
      expect({
        file,
        hit: /this\.state\.[A-Za-z]+\s*=[^=]/.test(text) || /this\.plan\.[A-Za-z]+\s*=[^=]/.test(text),
      }).toEqual({
        file,
        hit: false,
      });
    }
  });
});
