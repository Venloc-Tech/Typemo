import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Style rules for the aggregation sources: no prototype legacy, no untyped `this`, no `any` at all (the layer
 * needs none), no `Document` of the driver (its values are `any`).
 */

const ROOT = resolve(import.meta.dir, "../../../src/aggregate");

/** Every `.ts` file under `dir`, recursively. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });

/** The source of `file` without comments and string contents. */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    /* String contents are not code (the server-side JavaScript source of `$function` is a template). */
    .replace(/`[^`]*`/g, "``");

describe("guards: src/aggregate", () => {
  const sources = files(ROOT);

  test("the layer has its files", () => {
    expect(sources.length).toBeGreaterThan(15);
  });

  test.each(sources.map((file) => [file.slice(ROOT.length + 1), file]))("%s follows the style rules", (_name, file) => {
    const text = code(file);
    expect({ prototype: /\.prototype\.[A-Za-z_$]+\s*=/.test(text) }).toEqual({ prototype: false });
    expect({ inherits: text.includes("util.inherits") }).toEqual({ inherits: false });
    expect({ anyType: /[:<,|&(]\s*any\b(?!\w)/.test(text) || /\bas any\b/.test(text) }).toEqual({ anyType: false });
    expect({
      driverDocument: /\bDocument\b(?!\w)/.test(text.replace(/AnyDocument|ChangeStreamDocument/g, "")),
    }).toEqual({
      driverDocument: false,
    });
    for (const match of text.matchAll(/\bfunction\s*\(([^)]*)\)/g)) {
      expect({ fn: match[0], typedThis: (match[1] ?? "").trimStart().startsWith("this:") }).toEqual({
        fn: match[0],
        typedThis: true,
      });
    }
  });
});
