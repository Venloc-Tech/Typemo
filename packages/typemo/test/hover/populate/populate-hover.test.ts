import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for populated results — a hydrated populated field is a document of its model, arrays and
 * Maps of them are read-only, a transform types the field by its result — and that the populate errors are
 * readable (they name the path and the rule).
 */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `
import type { HydratedDoc, ModelOperations } from "../../src/index.ts";
import type { Person, Order, Activity, Canvas, Post } from "./populate/populate-entities.ts";
declare const People: ModelOperations<Person>;
declare const Posts: ModelOperations<Post>;
declare const Orders: ModelOperations<Order>;
declare const Activities: ModelOperations<Activity>;
declare const Canvases: ModelOperations<Canvas>;
declare const person: HydratedDoc<Person>;
`;

/** The hover of a company populated without select. */
const FULL_COMPANY = "const company: HydratedDoc<Company> | null | undefined";

/** The compiler prints string literal types with escaped quotes. */
const printed = (message: string): string => message.replaceAll('"', '\\"');

describe("hover of populated results", () => {
  test("a hydrated single reference: a document of the target model, null when it is gone, or absent", () => {
    expectHover(
      `${HEAD}const doc = await People.findOne().populate({ path: "company", select: { name: 1 } }).orFail();\nconst company = doc.company;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe('const company: HydratedDoc<Projected<Company, "name" | "_id">> | null | undefined');
  });

  test("a hydrated array of references: a read-only array of documents", () => {
    expectHover(
      `${HEAD}const doc = await People.findOne().populate("friends").orFail();\nconst friends = doc.friends;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const friends: readonly HydratedDoc<Person>[]");
  });

  test("a hydrated Map of references: a read-only Map of documents", () => {
    expectHover(
      `${HEAD}const doc = await Orders.findOne().populate("extras.$*").orFail();\nconst extras = doc.extras;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const extras: ReadonlyMap<string, HydratedDoc<Product> | null> | undefined");
  });

  test("lean: plain data; match gives | null", () => {
    expectHover(
      `${HEAD}const doc = await People.findOne().populate({ path: "company", select: { name: 1 }, match: { size: 1 } }).orFail().lean();\nconst company = doc.company;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const company: { name: string; _id: ObjectId; } | null | undefined");
  });

  test("transform: the field is what the transform returns", () => {
    expectHover(
      `${HEAD}const doc = await People.findOne().populate({ path: "friends", transform: (friend) => friend?.name ?? "" }).orFail().lean();\nconst names = doc.friends;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const names: string[]");
  });

  test("the transform's parameters are typed by the target and the id", () => {
    expectHover(
      `${HEAD}People.findOne().populate({ path: "company", select: { name: 1 }, transform: (company, id) => {\n  const c = company;\n  //    ^?\n  return id; } });`,
      { dir: FIXTURES },
    ).toBe("const c: { name: string; _id: ObjectId; } | null");
  });

  test("$depopulate gives back the stored reference", () => {
    expectHover(
      `${HEAD}const doc = (await person.$populate("company")).$depopulate("company");\nconst company = doc.company;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const company: Ref<Company> | undefined");
  });
});

describe("hover of a whole populated document: the class and the populated paths, no markers", () => {
  test.each([
    [
      "one path",
      `const doc = await Posts.findOne().populate("author").orFail();`,
      "const doc: HydratedDocWith<Post, { author: HydratedDoc<Person> | null; }>",
    ],
    [
      "a list of paths (a reference, an array, a virtual)",
      `const doc = await People.findOne().populate(["company", "friends", "posts"]).orFail();`,
      "const doc: HydratedDocWith<Person, { company?: HydratedDoc<Company> | null; friends: readonly HydratedDoc<Person>[]; posts: readonly HydratedDoc<Post>[]; }>",
    ],
    [
      "a nested populate",
      `const doc = await person.$populate({ path: "mentor", populate: "company" });`,
      "const doc: HydratedDocWith<Person, { mentor?: HydratedDocWith<Person, { company?: HydratedDoc<Company> | null; }> | null; }>",
    ],
    [
      "a reference inside an array of subdocuments",
      `const doc = await Orders.findOne().populate("lines.product").orFail();`,
      "const doc: HydratedDocWith<Order, { lines: FieldsWith<Line, { product: HydratedDoc<Product> | null; }>[]; }>",
    ],
    [
      "$depopulate gives back HydratedDoc<Entity>",
      `const doc = (await person.$populate(["company", "friends"])).$depopulate();`,
      "const doc: HydratedDoc<Person>",
    ],
    [
      "$depopulate of one path keeps the others",
      `const doc = (await person.$populate(["company", "friends"])).$depopulate("company");`,
      "const doc: HydratedDocWith<Person, { friends: readonly HydratedDoc<Person>[]; }>",
    ],
    [
      "$assertPopulated with a list of paths",
      `const doc = person.$assertPopulated(["company", { path: "friends", select: { name: 1 } }]);`,
      'const doc: HydratedDocWith<Person, { company?: HydratedDoc<Company> | null; friends: readonly HydratedDoc<Projected<Person, "name" | "_id">>[]; }>',
    ],
  ])("%s", (_name, code, expected) => {
    expectHover(`${HEAD}${code}\n//    ^?`, { dir: FIXTURES }).toBe(expected);
  });
});

describe("hover of a document in any population state (R61)", () => {
  const ANY_HEAD = `
import { type AnyPopulationDoc, isPopulated } from "../../src/index.ts";
import type { Post } from "./populate/populate-entities.ts";
declare const post: AnyPopulationDoc<Post>;
`;

  test("the form reads by its name, without the default second argument", () => {
    expectHover(`${ANY_HEAD}const doc = post;\n//    ^?`, { dir: FIXTURES }).toBe("const doc: AnyPopulationDoc<Post>");
  });

  test("a reference: the id, a document of the target in any state, or null", () => {
    expectHover(`${ANY_HEAD}const author = post.author;\n//    ^?`, { dir: FIXTURES }).toBe(
      "const author: Ref<Person> | AnyPopulationDoc<Person> | null",
    );
  });

  test("isPopulated narrows the document and the reference", () => {
    expectHover(`${ANY_HEAD}if (isPopulated(post, "author")) {\n  const doc = post;\n  //    ^?\n}`, {
      dir: FIXTURES,
    }).toBe('const doc: PartlyPopulatedDoc<Post, "author">');
    expectHover(`${ANY_HEAD}if (isPopulated(post, "author")) {\n  const author = post.author;\n  //    ^?\n}`, {
      dir: FIXTURES,
    }).toBe("const author: AnyPopulationDoc<Person> | null");
  });
});

describe("readable populate errors", () => {
  test.each([
    [`People.find().populate("compny");`, 'Invalid populate path "compny": unknown field "compny"'],
    [`People.find().populate("name");`, 'Invalid populate path "name": "name" is not a reference'],
    [
      `Activities.find().populate("target.author");`,
      '"target" is a polymorphic reference: nothing below it can be populated',
    ],
    [
      `People.find().populate({ path: "postCount", select: { title: 1 } });`,
      'a count virtual \\"postCount\\" takes no \\"select\\"',
    ],
    [
      `People.find().populate({ path: "posts", retainNullValues: true });`,
      'retainNullValues of "posts": a virtual has no positions to keep',
    ],
    [
      `People.find().populate({ path: "friends", match: () => ({ nmae: "x" }) });`,
      'match of "friends": unknown field "nmae"',
    ],
    [
      `People.find().populate({ path: "friends", transform: (friend) => friend?.title });`,
      "Property 'title' does not exist",
    ],
    [
      `(async () => { const doc = await person.$populate("mentor"); doc.$populate("mentor.company"); })();`,
      '"mentor" is populated already: $depopulate(\\"mentor\\") first',
    ],
  ])("%s", (code, message) => {
    expectTypeError(`${HEAD}${code}`, { dir: FIXTURES }).toContain(printed(message).replaceAll("\\\\", "\\"));
  });

  test("a populated path populated again: typed by the second call, no $depopulate needed", () => {
    expectHover(
      `${HEAD}const doc = await person.$populate({ path: "company", select: { name: 1 } });\nconst again = await doc.$populate("company");\nconst company = again.company;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe(FULL_COMPANY);
    /* the same as a first populate without select (the hidden `secret` is out of the default view) */
    expectHover(`${HEAD}const doc = await person.$populate("company");\nconst company = doc.company;\n//    ^?`, {
      dir: FIXTURES,
    }).toBe(FULL_COMPANY);
  });

  test("a populated Map of references and a populated array populated again", () => {
    expectHover(
      `${HEAD}const doc = await (await person.$populate("tagsByTopic.$*")).$populate("tagsByTopic.$*");\nconst tags = doc.tagsByTopic;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const tags: ReadonlyMap<string, HydratedDoc<Tag> | null> | undefined");
    expectHover(
      `${HEAD}const doc = await (await person.$populate("friends")).$populate({ path: "friends", select: { name: 1 } });\nconst friends = doc.friends;\n//    ^?`,
      { dir: FIXTURES },
    ).toBe('const friends: readonly HydratedDoc<Projected<Person, "name" | "_id">>[]');
  });

  test("an embedded discriminator's field is a valid path", () => {
    expectHover(
      `${HEAD}const doc = await Canvases.findOne().populate("shapes.owner").orFail().lean();\nconst shape = doc.shapes[0];\n//    ^?`,
      { dir: FIXTURES },
    ).toContain("radius: number");
  });
});
