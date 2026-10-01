/*
 * Style rules for the populate sources: classes only, no prototype patching, no `any`, typed `this`, BSON values
 * compared by key, never `==`; and the populate input (specs, their select/match/options, the document methods'
 * arguments) is never mutated — frozen inputs work and stay equal (Mongoose mutated them; Mongoose H156).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const DIR = resolve(import.meta.dir, "../../../src/populate");
const FILES = [
  ...readdirSync(DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(DIR, name)),
  resolve(import.meta.dir, "../../../src/document/populated-fields.ts"),
  resolve(import.meta.dir, "../../../src/types/populate.ts"),
];

/** The source of `file` without comments and string contents. */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"[^"\n]*"|`[^`]*`/g, '""');

describe("guards: src/populate", () => {
  test("the directory has the expected files", () => {
    expect(FILES.length).toBeGreaterThan(6);
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

  test("values are matched by key (PopulateKeys), never with == or String()", () => {
    for (const file of FILES) {
      const text = code(file);
      expect({ file, loose: /[^=!]==[^=]|!=[^=]/.test(text) }).toEqual({ file, loose: false });
    }
  });
});

const t = ModelLifecycle.useTypemo("pop_guards");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

/** Freezes `value` and everything reachable from it. */
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};

describe("populate does not mutate its input", () => {
  test("frozen specs (select, match, options, nested) in queries and on documents", async () => {
    const spec = deepFreeze({
      path: "friends",
      select: { name: 1, company: 1 },
      match: { age: { $gte: 0 } },
      options: { sort: { name: 1 }, limit: 5 },
      populate: { path: "company", select: { name: 1 } },
    } as const);
    const list = deepFreeze(["company", { path: "posts", options: { sort: { views: -1 } } }] as const);
    const before = JSON.stringify([spec, list]);
    await m.People.findById(P.ann).populate(spec).lean();
    await m.People.find().populate(list);
    const doc = await m.People.findById(P.ann).orFail();
    await doc.$populate(spec);
    await doc.$populate(deepFreeze({ path: "topPost", select: { title: 1, author: 1 } } as const));
    expect(JSON.stringify([spec, list])).toBe(before);
  });
});
