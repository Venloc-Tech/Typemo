import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/* What the IDE shows for the model's operations and results, and that their type errors are readable. */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `
import { ObjectId } from "mongodb";
import { fn, type Model, type TypemoClient } from "../../src/index.ts";
import type { Person } from "./model/model-entities.ts";
declare const People: Model<Person>;
declare const client: TypemoClient;
declare const id: ObjectId;
`;

describe("hover of model results", () => {
  test("create returns the entity, with the Hidden field it was given", () => {
    expectHover(
      `${HEAD}const doc = await People.create({ name: "A", email: "a", tags: [], pets: [], lastSeen: null });\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const doc: HydratedDocWith<Person, { secret?: string; }>"); /* made from input: Hidden listed */
  });

  test("insertMany returns entities, with their Hidden fields", () => {
    expectHover(`${HEAD}const docs = await People.insertMany([]);\n//    ^?`, { dir: FIXTURES }).toBe(
      "const docs: HydratedDocWith<Person, { secret?: string; }>[]",
    );
  });

  test("bulkWrite result ids are typed by _id", () => {
    expectHover(
      `${HEAD}const r = await People.bulkWrite([{ deleteOne: { filter: { _id: id } } }]);\nconst ids = r.insertedIds;\n//    ^?`,
      {
        dir: FIXTURES,
      },
    ).toBe("const ids: Readonly<Record<number, ObjectId>>");
  });

  test("aggregate rows from the pipeline", () => {
    expectHover(
      `${HEAD}const rows = await People.aggregate((p) => p.group((f) => ({ _id: f.role, n: fn.sum(1) })));\n//    ^?`,
      { dir: FIXTURES },
    ).toBe('const rows: { _id: "admin" | "user"; n: number; }[]'); /* union order as the compiler prints it */
  });

  test("a cursor's typed map", () => {
    expectHover(`${HEAD}const names = People.find().lean().cursor().map((p) => p.email);\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const names: QueryCursor<string>");
  });

  test("transaction returns the callback's value", () => {
    expectHover(`${HEAD}const n = await client.transaction(async () => People.countDocuments());\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const n: number");
  });
});

describe("readable errors", () => {
  test("an unknown field in a bulkWrite filter names the field", () => {
    expectTypeError(`${HEAD}People.bulkWrite([{ deleteOne: { filter: { nmae: "x" } } }]);`, {
      dir: FIXTURES,
    }).toContain("nmae");
  });

  test("a create input without a required field names it", () => {
    expectTypeError(`${HEAD}People.create({ name: "A", tags: [], pets: [], lastSeen: null });`, {
      dir: FIXTURES,
    }).toContain("email");
  });
});
