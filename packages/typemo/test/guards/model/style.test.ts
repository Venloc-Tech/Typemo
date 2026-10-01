import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/*
 * Style rules for the connection, model, operation, cursor, error and instrumentation sources: classes only,
 * typed `this`, no `any`, and the DriverExecutor is the ONLY place that calls the driver's collection/database
 * operations.
 */

const SOURCES = resolve(import.meta.dir, "../../../src");

/** Every `.ts` file under `dir`, recursively. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });

const AREAS = [
  "connection",
  "model",
  "operation/pipeline",
  "operation/executor",
  "cursor",
  "errors",
  "instrumentation",
];
const L4 = AREAS.flatMap((area) => files(join(SOURCES, area)));

/** The source of `file` without comments. */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

describe("guards: connection, model and operation sources", () => {
  test("no prototype legacy, no untyped `this`", () => {
    for (const file of L4) {
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

  test("no `any`", () => {
    for (const file of L4) {
      const text = code(file).replace(/"[^"\n]*"|`[^`]*`/g, "");
      expect({ file, any: /:\s*any\b|<any>|any\[\]|as any\b/.test(text) }).toEqual({ file, any: false });
    }
  });

  test("only the DriverExecutor calls driver operations (find, insert, update, aggregate, bulkWrite, indexes)", () => {
    const DRIVER_CALL =
      /\.(find|findOne|insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|findOneAndUpdate|findOneAndReplace|findOneAndDelete|countDocuments|estimatedDocumentCount|distinct|aggregate|bulkWrite|watch|createIndexes|dropIndex|listIndexes|createCollection|listCollections)\(/;
    const offenders = L4.filter((file) => !file.endsWith("driver-executor.ts"))
      .filter((file) => /\bcollection\(|\.db\(|driver\.db/.test(code(file)))
      .filter((file) => {
        const text = code(file);
        return text
          .split("\n")
          .filter(
            (line) => !/\b(DriverExecutor|ModelIndexes)\./.test(line),
          ) /* calls THROUGH the executor are the rule */
          .some((line) => /(collection\(|driver\.db|\.mongo\b)/.test(line) && DRIVER_CALL.test(line));
      })
      .map((file) => relative(SOURCES, file));
    expect(offenders).toEqual([]);
  });
});
