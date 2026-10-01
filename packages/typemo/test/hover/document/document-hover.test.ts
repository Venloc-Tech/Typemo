import { describe, test } from "bun:test";
import { expectHover } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for hydrated documents — a SHORT hover (`HydratedDoc<Order>`), the typed collections by
 * name, the methods from one interface.
 */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `
import { type Model } from "../../src/index.ts";
import type { Order, PlainDoc } from "./document/document-entities.ts";
declare const Orders: Model<Order>;
declare const Plains: Model<PlainDoc>;
`;

describe("hover of hydrated documents", () => {
  test("a read document is HydratedDoc<Entity>", () => {
    expectHover(`${HEAD}const doc = await Plains.findOne({ name: "a" });\n//    ^?`, { dir: FIXTURES }).toBe(
      "const doc: HydratedDoc<PlainDoc> | null",
    );
  });

  test("an entity with Hidden fields: the default read is HydratedDoc<Entity> (no fields spelled out, no markers)", () => {
    expectHover(`${HEAD}const order = await Orders.findOne({ customer: "a" });\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const order: HydratedDoc<Order> | null");
  });

  test("a Hidden field selected with +path: HydratedDocWith lists only that field", () => {
    expectHover(`${HEAD}const order = await Orders.findOne().select({ "+secret": true }).orFail();\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const order: HydratedDocWith<Order, { secret?: string; }>");
  });

  test("a dynamic projection: HydratedDoc<Partial<Entity>> without markers", () => {
    expectHover(
      `${HEAD}declare const fields: Record<string, 0 | 1>;\nconst order = await Orders.findOne().select(fields).orFail();\n//    ^?`,
      { dir: FIXTURES },
    ).toBe("const order: HydratedDoc<Partial<Order>>");
  });

  test("literal projections: Projected / Omit of the class", () => {
    expectHover(`${HEAD}const order = await Orders.findOne().select({ customer: 1 }).orFail();\n//    ^?`, {
      dir: FIXTURES,
    }).toBe('const order: HydratedDoc<Projected<Order, "customer" | "_id">>');
    expectHover(`${HEAD}const order = await Orders.findOne().select({ tags: 0 }).orFail();\n//    ^?`, {
      dir: FIXTURES,
    }).toBe('const order: HydratedDoc<Omit<Order, "tags">>');
  });

  test("model.new(): Hidden listed; timestamps and version optional until the first save", () => {
    expectHover(`${HEAD}const order = Orders.new({ customer: "a", tags: [], lines: [] });\n//    ^?`, {
      dir: FIXTURES,
    }).toBe(
      "const order: HydratedDocWith<Order, { secret?: string; createdAt?: Date; updatedAt?: Date; __v?: number; }>",
    );
    expectHover(`${HEAD}const order = await Orders.new({ customer: "a", tags: [], lines: [] }).$save();\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const order: HydratedDocWith<Order, { secret?: string; }>");
  });

  test("create() and insertOne(): made from input, so the Hidden field is listed (the values passed are there)", () => {
    expectHover(`${HEAD}const orders = await Orders.create([{ customer: "a", tags: [], lines: [] }]);\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const orders: HydratedDocWith<Order, { secret?: string; }>[]");
    expectHover(`${HEAD}const order = await Orders.insertOne({ customer: "a", tags: [], lines: [] });\n//    ^?`, {
      dir: FIXTURES,
    }).toBe("const order: HydratedDocWith<Order, { secret?: string; }>");
  });

  test("model.create() of an entity without Hidden fields: still the short HydratedDoc<Entity>", () => {
    expectHover(`${HEAD}const doc = await Plains.create({ name: "a" });\n//    ^?`, { dir: FIXTURES }).toBe(
      "const doc: HydratedDoc<PlainDoc>",
    );
  });

  test("the collections by name", () => {
    expectHover(
      `${HEAD}declare const order: import("../../src/index.ts").HydratedDoc<Order>;\nconst tags = order.tags;\n//    ^?`,
      {
        dir: FIXTURES,
      },
    ).toBe("const tags: StrictArray<string>");
    expectHover(
      `${HEAD}declare const order: import("../../src/index.ts").HydratedDoc<Order>;\nconst lines = order.lines;\n//    ^?`,
      {
        dir: FIXTURES,
      },
    ).toBe("const lines: SubdocumentArray<Line>");
  });

  test("$save resolves to the same document type", () => {
    expectHover(
      `${HEAD}declare const order: import("../../src/index.ts").HydratedDoc<Order>;\nconst saved = await order.$save();\n//    ^?`,
      {
        dir: FIXTURES,
      },
    ).toBe("const saved: HydratedDoc<Order>");
  });
});
