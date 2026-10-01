import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for query results, and that the errors of the query builders are readable (the message
 * names the field or path and the rule).
 */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `
import { ObjectId } from "mongodb";
import type { ModelOperations } from "../../src/index.ts";
import type { Member, Article } from "./query/query-entities.ts";
declare const Members: ModelOperations<Member>;
declare const Articles: ModelOperations<Article>;
declare const id: ObjectId;
`;

/** The compiler prints string literal types with escaped quotes. */
const printed = (message: string): string => message.replaceAll('"', '\\"');

describe("hover of query results", () => {
  test("an inclusion projection, lean, orFail", () => {
    expectHover(
      `${HEAD}const doc = await Members.findOne().select({ name: 1, tags: 1, _id: 0 }).orFail().lean();\n//    ^?`,
      {
        dir: FIXTURES,
      },
    ).toBe("const doc: { name: string; tags: string[]; }");
  });

  test("{ _id: 1 } alone", () => {
    expectHover(`${HEAD}const doc = await Members.findOne().select({ _id: 1 }).orFail().lean();\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const doc: { _id: ObjectId; }");
  });

  test("a populated single ref with match may be null", () => {
    expectHover(
      `${HEAD}const doc = await Articles.findOne().populate({ path: "author", match: { age: { $gt: 1 } }, select: { name: 1 } }).orFail().lean();\nconst author = doc.author;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const author: { _id: ObjectId; name: string; } | null");
  });

  test("narrowing by where(path).in(...) and exists()", () => {
    expectHover(
      `${HEAD}const [doc] = await Members.find().where("role").in(["admin"]).where("lastLogin").exists().select({ role: 1, lastLogin: 1 }).lean();\nconst pair = [doc?.role, doc?.lastLogin] as const;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe('const pair: readonly ["admin" | undefined, Date | null | undefined]');
  });

  test("then keeps the types", () => {
    expectHover(`${HEAD}const names = Members.find().lean().then((m) => m.map((x) => x.name));\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const names: Promise<string[]>");
  });

  test("an update result carries the entity's _id type", () => {
    expectHover(
      `${HEAD}const r = await Members.updateOne({ _id: id }, { $set: { name: "x" } });\nconst up = r.upsertedId;\n//    ^?`,
      {
        dir: FIXTURES,
      },
    ).toBe("const up: ObjectId | null");
  });
});

describe("readable errors of the query builders", () => {
  test.each([
    [`Members.find({ nmae: "x" });`, 'unknown field "nmae"'],
    [`Members.find({ "badges.gold.titel": "x" });`, 'unknown field "badges.gold.titel"'],
    [`Members.find({ "badges.gold.level": "3" });`, `"badges.gold.level": the condition does not fit the field's type`],
    [`Members.find({ $where: "x" });`, 'unknown operator "$where"'],
    [`Members.updateOne({ _id: id }, {});`, "an empty update changes nothing"],
    [
      `Members.updateOne({ _id: id }, { $set: { age: 1 }, $inc: { age: 1 } });`,
      '"age" is changed by two operators (server code 40)',
    ],
    [`Members.updateOne({ _id: id }, { $set: { nmae: "x" } });`, '"$set.nmae": unknown path'],
    [
      `Members.updateOne({ _id: id }, { $inc: { "badges.gold.title": 1 } });`,
      '"$inc" does not apply to "badges.gold.title"',
    ],
    [
      `Members.find().select({ name: 1, age: 0 });`,
      'cannot mix inclusion ("name") and exclusion ("age") in one projection',
    ],
    [`Members.find().populate("bestFrend");`, 'Invalid populate path "bestFrend": unknown field "bestFrend"'],
    [`Members.find().populate("name");`, 'Invalid populate path "name": "name" is not a reference'],
    [`Articles.find().populate({ path: "author", match: { nmae: "x" } });`, 'match of "author": unknown field "nmae"'],
    /*
     * The path is inferred first, so the object is checked against the options of its target: a typo is an
     * excess property with a suggestion.
     */
    [`Articles.find().populate({ path: "author", selct: { name: 1 } });`, "Did you mean to write 'select'?"],
    [`Members.findOne().skip(1);`, "skip() applies to find()"],
    [`Members.find().includeResultMetadata();`, "includeResultMetadata() applies to findOneAnd*()"],
    [`Members.find().where("active").gte(true);`, "this field has no order"],
  ])("%s", (code, message) => {
    expectTypeError(`${HEAD}${code}`, { dir: FIXTURES }).toContain(printed(message));
  });

  test("undefined is refused without exactOptionalPropertyTypes too", () => {
    expectTypeError(`${HEAD}declare const maybe: string | undefined;\nMembers.find({ name: maybe });`, {
      dir: FIXTURES,
    }).toContain("undefined");
  });
});
