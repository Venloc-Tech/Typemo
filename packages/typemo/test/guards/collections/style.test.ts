import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Style rules for the typed collections: classes only, no prototype patching, no Proxy (the collections are real
 * Array/Map subclasses), no `any`, typed `this`.
 */

const DIR = resolve(import.meta.dir, "../../../src/document/collections");
const FILES = readdirSync(DIR)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(DIR, name));

/** The source of `file` without comments and string contents. */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"[^"\n]*"|`[^`]*`/g, '""');

describe("guards: typed collections", () => {
  test("the directory has the expected files", () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  test("no prototype assignment, no setPrototypeOf, no Proxy, no util.inherits", () => {
    for (const file of FILES) {
      const text = code(file);
      const hits = [/\.prototype\.[A-Za-z_$]+\s*=[^=]/, /setPrototypeOf/, /new Proxy\b/, /util\.inherits/].filter(
        (re) => re.test(text),
      );
      expect({ file, hits: hits.map(String) }).toEqual({ file, hits: [] });
    }
  });

  test("no `any`, and every plain `function` has a typed `this`", () => {
    for (const file of FILES) {
      const text = code(file);
      expect({ file, any: /:\s*any\b|<any>|any\[\]|as any\b/.test(text) }).toEqual({ file, any: false });
      for (const match of text.matchAll(/\bfunction\s*\(([^)]*)\)/g)) {
        expect({ file, typedThis: (match[1] ?? "").trimStart().startsWith("this:") }).toEqual({
          file,
          typedThis: true,
        });
      }
    }
  });

  test("ObjectId and other BSON values are compared with equals, never ==", () => {
    for (const file of FILES) {
      expect({ file, loose: /[^=!]==[^=]|!=[^=]/.test(code(file)) }).toEqual({ file, loose: false });
    }
  });
});
