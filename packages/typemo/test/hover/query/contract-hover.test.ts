import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for the contract types (`Selected`, `SelectedLean`, `SelectedJson`), the plain rows of
 * `.plain()` and `$toPlain()`, the parsed result of `.parse(schema)`, a document narrowed by `$is`, the result of
 * `$assertPopulated` — and that the contract errors are READABLE: the message prints
 * `{ missing | extra | mismatch }` with the paths.
 */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `
import type { HydratedDoc, Model, ModelOperations, Selected, SelectedJson, SelectedLean } from "../../src/index.ts";
import { Contract } from "../../src/index.ts";
import { z } from "@venloc/typemo-test-kit";
import type { Company, Person, Post } from "./populate/populate-entities.ts";
import { Event, Signup } from "./populate/populate-entities.ts";
declare const People: ModelOperations<Person>;
declare const Posts: ModelOperations<Post>;
declare const Events: ModelOperations<Event>;
declare const PeopleModel: Model<Person>;
declare const person: HydratedDoc<Person>;
`;

describe("hover of contracts", () => {
  test("Selected: the plain form, _id first (a string), optional fields kept", () => {
    expectHover(
      `${HEAD}type Card = Selected<Person, "name" | "age">;\nconst card = null as unknown as Card;\n//    ^?`,
      {
        dir: FIXTURES,
      },
    ).toBe("const card: { _id: string; name: string; age?: number; }");
  });

  test("Selected: a Map stays a Map of plain values, references as strings", () => {
    expectHover(
      `${HEAD}type Row = Selected<Person, "tagsByTopic" | "company" | "-_id">;\nconst row = null as unknown as Row;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const row: { tagsByTopic?: Map<string, string>; company?: string; }");
  });

  test("SelectedLean: the lean form", () => {
    expectHover(
      `${HEAD}type Card = SelectedLean<Person, "name" | "age">;\nconst card = null as unknown as Card;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const card: { _id: ObjectId; name: string; age?: number; }");
  });

  test("SelectedLean with a nested populated override and -_id", () => {
    expectHover(
      `${HEAD}type Row = SelectedLean<Post, "title" | "author", { author: SelectedLean<Person, "name" | "-_id"> }>;\nconst row = null as unknown as Row;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const row: { _id: ObjectId; title: string; author: { name: string; }; }");
  });

  test("SelectedJson: ids as strings", () => {
    expectHover(
      `${HEAD}type Json = SelectedJson<Person, "name" | "company">;\nconst json = null as unknown as Json;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const json: { _id: string; name: string; company?: string; }");
  });

  test("expect<Shape>() keeps the query: the rows as they are", () => {
    expectHover(
      `${HEAD}const rows = await People.find().select({ name: 1 }).lean().expect<SelectedLean<Person, "name">>();\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const rows: { name: string; _id: ObjectId; }[]");
  });
});

describe("hover of the plain form", () => {
  test(".plain() of a projection: ids as strings", () => {
    expectHover(`${HEAD}const rows = await People.find().select({ name: 1, company: 1 }).plain();\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const rows: { name: string; company?: string; _id: string; }[]");
  });

  test("$toPlain() of a document: the plain form of its fields", () => {
    expectHover(`${HEAD}const tags = person.$toPlain().tagsByTopic;\n//    ^?`, { dir: FIXTURES }).toBe(
      "const tags: Map<string, string> | undefined",
    );
    expectHover(`${HEAD}const id = person.$toPlain()._id;\n//    ^?`, { dir: FIXTURES }).toBe("const id: string");
  });

  test(".plain() of a populated reference: a plain document", () => {
    expectHover(
      `${HEAD}const post = await Posts.findOne().populate({ path: "author", select: { name: 1 } }).orFail().plain();\nconst author = post.author;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const author: { _id: string; name: string; } | null");
  });

  test("aggregate().plain(): the row's plain values", () => {
    expectHover(
      `${HEAD}const rows = await PeopleModel.aggregate((p) => p.project({ company: 1 })).plain();\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const rows: { company?: string; _id: string; }[]");
  });
});

describe("readable contract errors", () => {
  test.each([
    [
      `People.find().select({ name: 1, age: 1 }).lean().expect<SelectedLean<Person, "name">>();`,
      `{ readonly extra: "age"; }`,
    ],
    [
      `People.find().select({ name: 1 }).lean().expect<SelectedLean<Person, "name" | "age" | "company">>();`,
      `{ readonly missing: "age" | "company"; }`,
    ],
    [
      `People.find().select({ name: 1 }).lean().expect<{ _id: string; name: string }>();`,
      `{ readonly mismatch: "_id"; }`,
    ],
    [
      `Posts.find().select({ author: 1 }).populate({ path: "author", select: { name: 1 } }).lean().expect<{ _id: import("mongodb").ObjectId; author: { name: string } | null }>();`,
      `{ readonly extra: "author._id"; }`,
    ],
    [
      `People.find().select({ friends: 1 }).lean().expect<{ _id: import("mongodb").ObjectId; friends: string[] }>();`,
      `{ readonly mismatch: "friends[]"; }`,
    ],
    [
      `Contract.check<SelectedJson<Person, "name">>()(person.$toJSON());`,
      `{ readonly extra: "age" | "company" | "mentor" | "friends" | "tagsByTopic"; }`,
    ],
    [
      `Contract.check<Selected<Person, "name" | "tagsByTopic">>()(person.$toPlain({ hidden: true }));`,
      `{ readonly extra: "age" | "company" | "mentor" | "friends"; }`,
    ],
    [
      `People.find().select({ name: 1 }).plain().expect<SelectedLean<Person, "name">>();`,
      `{ readonly mismatch: "_id"; }`,
    ],
    [
      `People.find().select({ name: 1 }).expect<Selected<Person, "name">>();`,
      "expect<Shape>() checks rows: call .plain() or .lean() first (for a document, Contract.check its $toPlain())",
    ],
    [
      `type X = Selected<Person, "name", { company: Selected<Company, "name"> }>;`,
      'the override \\"company\\" is not one of the selected fields',
    ],
  ])("%s", (code, message) => {
    expectTypeError(`${HEAD}${code}`, { dir: FIXTURES }).toContain(message.replaceAll("\\\\", "\\"));
  });
});

describe("hover of parse", () => {
  test("a lean find parsed by zod: the schema's output per row", () => {
    expectHover(
      `${HEAD}const rows = await People.find().lean().parse(z.object({ name: z.string(), age: z.number().optional() }));\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const rows: { name: string; age?: number | undefined; }[]");
  });

  test("findOne keeps | null; the model's ~standard is typed by the entity", () => {
    expectHover(`${HEAD}const row = await People.findOne().lean().parse(z.object({ name: z.string() }));\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const row: { name: string; } | null");
    /* The input form is printed with its fields (the create input of Person), not as `CreateInput<Person>`. */
    expectHover(`${HEAD}const standard = PeopleModel["~standard"];\n//    ^?`, { dir: FIXTURES }).toBe(
      "const standard: StandardSchemaProps<{ name: string; age?: number; company?: string | Ref<Company> | RefDocumentInput<Ref<Company>>; mentor?: string | Ref<Person> | RefDocumentInput<Ref<Person>> | null; tagsByTopic?: ReadonlyMap<string, string | Ref<Tag> | RefDocumentInput<Ref<Tag>>> | { readonly [key: string]: string | Ref<Tag> | RefDocumentInput<Ref<Tag>>; }; friends?: readonly (string | Ref<Person> | RefDocumentInput<Ref<Person>>)[]; _id?: string | ObjectId; }, DataFields<Person>>",
    );
  });

  test("a hydrated query: the error says to call lean() or plain()", () => {
    expectTypeError(`${HEAD}People.find().parse(z.object({ name: z.string() }));`, { dir: FIXTURES }).toContain(
      "parse() validates rows: call .lean() or .plain() before .parse(schema)",
    );
  });

  test("a plain find parsed: the schema's output per row", () => {
    expectHover(`${HEAD}const rows = await People.find().plain().parse(z.object({ _id: z.string() }));\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const rows: { _id: string; }[]");
  });
});

describe("hover of $is / $assertPopulated", () => {
  test("$is narrows a document of the base model to the discriminator class", () => {
    expectHover(
      `${HEAD}const event = await Events.findOne().orFail();\nif (event.$is(Signup)) {\n  const user = event.user;\n  //    ^?\n}`,
      { dir: FIXTURES },
    ).toBe("const user: Ref<Person>");
  });

  test("$assertPopulated: the path in its populated form", () => {
    expectHover(`${HEAD}const company = person.$assertPopulated("company").company;\n//    ^?`, { dir: FIXTURES }).toBe(
      "const company: HydratedDoc<Company> | null | undefined",
    );
  });

  test("$assertPopulated of a field that is not a reference: the populate error", () => {
    /* (the message is a string literal type: the compiler prints its quotes escaped) */
    expectTypeError(`${HEAD}person.$assertPopulated("name");`, { dir: FIXTURES }).toContain(
      'Invalid populate path \\"name\\": \\"name\\" is not a reference',
    );
  });
});
