import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for the typed collections of a hydrated document (clean names: `StrictArray<string>`, not an
 * expanded mapped type), and readable errors.
 */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `
import type { HydratedFields } from "../../src/index.ts";
import type { Doc } from "./collections/collection-entities.ts";
declare const doc: HydratedFields<Doc>;
const tags = doc.tags!;
const revisions = doc.revisions!;
`;

describe("hover of typed collections", () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ["an array of strings", "const a = doc.tags;", "const a: StrictArray<string> | undefined"],
    ["an element", "const a = tags[0];", "const a: string | undefined"],
    ["an array of refs", "const a = doc.owners!;", "const a: StrictArray<Ref<Owner>>"],
    ["a nested array", "const a = doc.matrix!;", "const a: StrictArray<StrictArray<number>>"],
    ["a subdocument array", "const a = revisions;", "const a: SubdocumentArray<Revision>"],
    ["a subdocument element", "const a = revisions[0];", "const a: Subdocument<Revision> | undefined"],
    ["id()", "const a = revisions.id(revisions[0]!._id);", "const a: Subdocument<Revision> | undefined"],
    ["discriminated elements", "const a = doc.shapes!;", "const a: SubdocumentArray<Circle | Square>"],
    ["a single subdocument", "const a = doc.address!;", "const a: Subdocument<Address>"],
    ["a nested object", "const a = doc.fullName!;", "const a: Subdocument<FullName>"],
    ["a Map", "const a = doc.scores!;", "const a: TypedMap<number>"],
    ["a Map of subdocuments", "const a = doc.badges!.get('gold');", "const a: Subdocument<Badge> | undefined"],
    ["a Map of arrays", "const a = doc.series!;", "const a: TypedMap<StrictArray<number>>"],
    ["a field of a subdocument element", "const a = revisions[0]!.tags;", "const a: StrictArray<string> | undefined"],
    ["$toObject of an array", "const a = tags.$toObject();", "const a: string[]"],
    ["$toObject of a Map", "const a = doc.scores!.$toObject();", "const a: Map<string, number>"],
    ["map() gives a plain array", "const a = tags.map((t) => t.length);", "const a: number[]"],
  ];
  for (const [name, line, expected] of cases) {
    test(name, () => {
      expectHover(`${HEAD}${line}\n//    ^?`, { dir: FIXTURES }).toBe(expected);
    });
  }
});

describe("readable errors", () => {
  test("an index write says the index signature is read-only (TS2542)", () => {
    expectTypeError(`${HEAD}tags[0] = "x";`, { dir: FIXTURES }).toContain("only permits reading");
  });

  test("a length write says length is read-only (TS2540)", () => {
    expectTypeError(`${HEAD}tags.length = 0;`, { dir: FIXTURES }).toContain("read-only property");
  });

  test("id() on elements without _id names the missing _id", () => {
    expectTypeError(`${HEAD}doc.points!.id(1 as never);`, { dir: FIXTURES }).toContain("_id");
  });

  test("a wrong element type names both types", () => {
    expectTypeError(`${HEAD}tags.push(5);`, { dir: FIXTURES }).toContain("number");
  });
});
