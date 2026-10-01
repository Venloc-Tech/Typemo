import { describe, test } from "bun:test";
import { expectHover } from "@venloc/typemo-test-kit";

/*
 * The IDE prints the forms of a document with their fields, never an alias name (`Plain<Holder, true>`,
 * `ObjectForm<Order, true>`, `Lean<X>`, `CreateInput<X>`, `UpdateInput<X>`, `Replacement<X>`, `Depopulated<…>`),
 * and a field read of a hydrated document without the internal markers (`string`, not `string & HiddenMarker`).
 */

/** How TypeScript prints the int64 string type (`Int64String`), spelled without a template-looking literal. */
const INT64_STRING = ["`$", "{bigint}`"].join("");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `
import type {
  CreateInput,
  HydratedDoc,
  HydratedDocWith,
  Lean,
  Model,
  Plain,
  Replacement,
  UpdateInput,
} from "../../src/index.ts";
import type { ObjectId } from "mongodb";
import type { Holder } from "./document/plain-entities.ts";
import type { Order, Person, Post } from "./populate/populate-entities.ts";
declare const Holders: Model<Holder>;
declare const Posts: Model<Post>;
declare const People: Model<Person>;
/* a holder read with its Hidden pin (select +pin): $toPlain({ hidden: true }) keeps it */
declare const holder: HydratedDocWith<Holder, { pin?: string }>;
declare const person: HydratedDoc<Person>;
declare const order: HydratedDoc<Order>;
declare const id: ObjectId;
`;
/** The spots Map of a Holder in the plain form. */
const PLAIN_SPOTS = `Map<string, { x: number; weight?: ${INT64_STRING}; marker?: string; }>`;
/** The input form of a Holder's fields. */
const INPUT_FIELDS = `score?: bigint | ${INT64_STRING}; spots?: ReadonlyMap<string, { x: number; weight?: bigint | ${INT64_STRING}; marker?: string | ObjectId; }> | { readonly [key: string]: { x: number; weight?: bigint | ${INT64_STRING}; marker?: string | ObjectId; }; }; pin?: string; boss?: string | Ref<Holder> | RefDocumentInput<Ref<Holder>>;`;

describe("the forms of a document hover with their fields", () => {
  test.each([
    [
      "$toPlain({ hidden: true })",
      "const x = holder.$toPlain({ hidden: true });",
      `const x: { name: string; score?: ${INT64_STRING}; spots?: ${PLAIN_SPOTS}; boss?: string; _id: string; pin?: string; }`,
    ],
    [
      "$toPlain()",
      "const x = holder.$toPlain();",
      `const x: { name: string; score?: ${INT64_STRING}; spots?: ${PLAIN_SPOTS}; boss?: string; _id: string; }`,
    ],
    [
      "$toObject()",
      "const x = order.$toObject();",
      "const x: { customer: Ref<Person>; lines: { product: Ref<Product>; qty: number; }[]; shipping?: { city: string; carrier?: Ref<Company>; }; extras?: Map<string, Ref<Product>>; notes?: Map<string, { text: string; author?: Ref<Person>; }>; _id: ObjectId; }",
    ],
    [
      "$toJSON()",
      "const x = holder.$toJSON();",
      `const x: { name: string; score?: ${INT64_STRING}; spots?: { [key: string]: { x: number; weight?: ${INT64_STRING}; marker?: string; }; }; boss?: string; _id: string; }`,
    ],
    [
      "Lean<X>",
      "declare const l: Lean<Holder>;\nconst x = l;",
      "const x: { name: string; score?: bigint; spots?: { [key: string]: { x: number; weight?: bigint; marker?: ObjectId; }; }; pin?: string; boss?: Ref<Holder>; _id: ObjectId; }",
    ],
    [
      "Plain<X, false>",
      "declare const l: Plain<Holder, false>;\nconst x = l;",
      `const x: { name: string; score?: ${INT64_STRING}; spots?: ${PLAIN_SPOTS}; boss?: string; _id: string; }`,
    ],
    [
      "CreateInput<X>",
      "declare const l: CreateInput<Holder>;\nconst x = l;",
      `const x: { name: string; ${INPUT_FIELDS} _id?: string | ObjectId; }`,
    ],
    [
      "UpdateInput<X>",
      "declare const l: UpdateInput<Holder>;\nconst x = l;",
      `const x: { name?: string; ${INPUT_FIELDS} }`,
    ],
    [
      "Replacement<X>",
      "declare const l: Replacement<Holder>;\nconst x = l;",
      `const x: { name: string; ${INPUT_FIELDS} }`,
    ],
  ])("%s", (_name, code, expected) => {
    expectHover(`${HEAD}${code}\n//    ^?`, { dir: FIXTURES }).toBe(expected);
  });
});

describe("a field read of a hydrated document has no markers", () => {
  test.each([
    ["an Immutable, Defaulted _id", "const x = holder._id;", "const x: ObjectId"],
    [
      "a Hidden field selected with +pin",
      'const d = await Holders.findById(id).select({ "+pin": true }).orFail();\nconst x = d.pin;',
      "const x: string | undefined",
    ],
    ["a reference keeps its meaning", "const x = holder.boss;", "const x: Ref<Holder> | undefined"],
    [
      "a populated reference",
      'const d = await Posts.findById(id).populate("author").orFail();\nconst x = d.author;',
      "const x: HydratedDoc<Person> | null",
    ],
  ])("%s", (_name, code, expected) => {
    expectHover(`${HEAD}${code}\n//    ^?`, { dir: FIXTURES }).toBe(expected);
  });
});

describe("depopulate and transform", () => {
  test("$depopulate() of a document with nothing populated is the document of its class", () => {
    expectHover(`${HEAD}const x = person.$depopulate();\n//    ^?`, { dir: FIXTURES }).toBe(
      "const x: HydratedDoc<Person>",
    );
    expectHover(`${HEAD}const x = person.$depopulate("company");\n//    ^?`, { dir: FIXTURES }).toBe(
      "const x: HydratedDoc<Person>",
    );
  });

  test("$depopulate(key) of a populated document gives the stored reference back", () => {
    expectHover(
      `${HEAD}const d = await Posts.findById(id).populate("author").orFail();\nconst x = d.$depopulate("author").author;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const x: Ref<Person>");
  });

  test("the document a populate transform receives is printed with its fields", () => {
    expectHover(
      `${HEAD}People.findOne().populate({ path: "company", transform: (company, key) => key });\n//                                                       ^?`,
      { dir: FIXTURES },
    ).toBe("(parameter) company: { name: string; _id: ObjectId; size?: number; } | null");
  });
});
