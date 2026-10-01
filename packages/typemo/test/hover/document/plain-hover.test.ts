import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for the plain form — `$toPlain()` of a document, `.plain()` rows, a vector field, the fields
 * of every BSON type — and the readable errors (`.plain()` options, a vector declared as a Binary).
 */

/** How TypeScript prints the int64 string type (`Int64String`), spelled without a template-looking literal. */
const INT64_STRING = ["`$", "{bigint}`"].join("");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `
import type { HydratedDocWith, Model } from "../../src/index.ts";
import { Prop, Schema, Spec, Types } from "../../src/index.ts";
import type { Binary, ObjectId } from "mongodb";
import type { AllForms, Holder, Vault } from "./document/plain-entities.ts";
declare const All: Model<AllForms>;
declare const Holders: Model<Holder>;
declare const Vaults: Model<Vault>;
/* documents read with their Hidden fields, so $toPlain({ hidden: true }) has them (a default read has not) */
const vault = await Vaults.findOne().select({ "+main.code": true }).orFail();
declare const doc: HydratedDocWith<AllForms, { secret?: string }>;
declare const id: ObjectId;
`;

describe("hover of the plain form", () => {
  test.each([
    ["an int64", "const v = doc.$toPlain().long;", `const v: ${INT64_STRING} | undefined`],
    ["a Decimal128", "const v = doc.$toPlain().dec;", "const v: string | undefined"],
    ["a UUID", "const v = doc.$toPlain().uuid;", "const v: string | undefined"],
    ["a Date (kept)", "const v = doc.$toPlain().date;", "const v: Date | undefined"],
    ["a Binary", "const v = doc.$toPlain().bin;", "const v: Uint8Array<ArrayBuffer> | undefined"],
    ["a vector", "const v = doc.$toPlain().vBits;", "const v: number[] | undefined"],
    ["a RegExp (kept)", "const v = doc.$toPlain().re;", "const v: RegExp | undefined"],
    ["a Timestamp", "const v = doc.$toPlain().ts;", "const v: TimestampJson | undefined"],
    ["nested arrays of int64", "const v = doc.$toPlain().grid;", `const v: ${INT64_STRING}[][]`],
    [
      "a Map of subdocuments",
      "const v = doc.$toPlain().spotsByName;",
      `const v: Map<string, { x: number; weight?: ${INT64_STRING}; marker?: string; }> | undefined`,
    ],
    [
      "a Hidden field with { hidden: true }",
      "const v = doc.$toPlain({ hidden: true }).secret;",
      "const v: string | undefined",
    ],
    ["the vector field of the document", "const v = doc.vBits;", "const v: Vector | undefined"],
  ])("%s", (_name, code, expected) => {
    expectHover(`${HEAD}${code}\n//    ^?`, { dir: FIXTURES }).toBe(expected);
  });

  test(".plain() of a list: the plain rows", () => {
    expectHover(`${HEAD}const rows = await Holders.find().select({ name: 1, score: 1 }).plain();\n//    ^?`, {
      dir: FIXTURES,
    }).toBe(`const rows: { name: string; score?: ${INT64_STRING}; _id: string; }[]`);
  });

  test(".plain({ hidden: true }) keeps the Hidden field the query selected", () => {
    expectHover(
      `${HEAD}const row = await Holders.findById(id).select({ name: 1, "+pin": true }).orFail().plain({ hidden: true });\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const row: { name: string; pin?: string; _id: string; }");
  });
});

describe("collections, int64 input, Hidden at every depth", () => {
  test.each([
    ["R24: a collection gives its object form", "const v = doc.holders.$toObject();", "const v: Ref<Holder>[]"],
    ["R24: the document gives the plain form", "const v = doc.$toPlain().holders;", "const v: string[]"],
    [
      "R26: $toPlain() of a subdocument, Hidden out",
      "const v = vault.$toPlain().main;",
      "const v: { label: string; } | undefined",
    ],
    [
      "R26: $toPlain({ hidden: true }) of a subdocument",
      "const v = vault.$toPlain({ hidden: true }).main;",
      "const v: { label: string; code?: string; } | undefined",
    ],
    [
      "R26: $toJSON() of an array of subdocuments",
      "const v = vault.$toJSON().lockers;",
      "const v: { label: string; }[]",
    ],
    [
      "R26: $toJSON() of a Map of subdocuments",
      "const v = vault.$toJSON().byRoom;",
      "const v: { [key: string]: { label: string; }; } | undefined",
    ],
  ])("%s", (_name, code, expected) => {
    expectHover(`${HEAD}${code}\n//    ^?`, { dir: FIXTURES }).toBe(expected);
  });

  test(".plain() of a populated document selected with its Hidden field", () => {
    expectHover(
      `${HEAD}const row = await Holders.findById(id).populate({ path: "boss", select: { name: 1, pin: 1 } }).orFail().plain();\n//    ^?`,
      { dir: FIXTURES },
    ).toBe(
      `const row: { _id: string; name: string; score?: ${INT64_STRING}; spots?: Map<string, { x: number; weight?: ${INT64_STRING}; marker?: string; }>; boss?: { _id: string; name: string; } | null; }`,
    );
  });

  test("an int64 field of the create input also takes a decimal string", () => {
    expectHover(
      `${HEAD}import type { CreateInput } from "../../src/index.ts";\ndeclare const i: CreateInput<Holder>;\nconst v = i.score;\n//    ^?`,
      {
        dir: FIXTURES,
      },
    ).toBe(`const v: bigint | ${INT64_STRING} | undefined`);
  });

  test("a numeric string that is not an int64 is refused with the field's type", () => {
    expectTypeError(`${HEAD}Holders.create({ name: "n", score: "1.5" });`, { dir: FIXTURES }).toContain(INT64_STRING);
  });
});

describe("readable errors", () => {
  test(".plain() has { hidden } only", () => {
    expectTypeError(`${HEAD}All.find().plain({ getters: true });`, { dir: FIXTURES }).toContain("getters");
  });

  test("a vector field declared as a Binary", () => {
    expectTypeError(`${HEAD}@Schema() class V { @Prop(() => Spec.vector({ dtype: "int8" })) v?: Binary; }\nvoid V;`, {
      dir: FIXTURES,
    }).toContain("Spec.vector(...) needs the field type Vector");
  });

  test("a Vector field without Spec.vector", () => {
    expectTypeError(
      `${HEAD}import type { Vector } from "../../src/index.ts";\n@Schema() class V { @Prop(() => Types.Binary) v?: Vector; }\nvoid V;`,
      { dir: FIXTURES },
    ).toContain("a Vector field needs Spec.vector({ dtype, dimensions })");
  });

  test("@Schema has no toJSON option", () => {
    expectTypeError(
      `${HEAD}import { Entity } from "../../src/index.ts";\n@Schema({ collection: "x", toJSON: { virtuals: true } }) class S extends Entity {}\nvoid S;`,
      { dir: FIXTURES },
    ).toContain("@Schema has no toJSON/toObject options");
  });
});
