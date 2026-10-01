import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for the storage APIs — change streams, their events narrowed by operation type, keyset
 * pages, views, materialized results, sync reports.
 */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `
import { type Connection, type Model, TypedView } from "../../src/index.ts";
import { Article, type Imaged, TopArticle } from "./mechanisms/storage-entities.ts";
import { stateTotals } from "./mechanisms/storage-operations.ts";
declare const Imageds: Model<Imaged>;
declare const Articles: Model<Article>;
declare const connection: Connection;
`;

/** The hover assertion for `code` appended to `HEAD`. */
const hover = (code: string) => expectHover(`${HEAD}${code}`, { dir: FIXTURES });

describe("hover of storage results", () => {
  test("a model's change stream", () => {
    hover("const stream = await Imageds.watch();\n//    ^?").toBe(
      "const stream: ModelChangeStream<ChangeEvent<Imaged, Record<never, never>>>",
    );
  });

  test("the options are part of the event type", () => {
    hover(`const stream = await Imageds.watch({ fullDocument: "updateLookup" });\n//    ^?`).toBe(
      'const stream: ModelChangeStream<ChangeEvent<Imaged, { readonly fullDocument: "updateLookup"; }>>',
    );
  });

  test("an event narrowed by operationType is its interface", () => {
    hover(
      `const stream = await Imageds.watch();\nconst event = await stream.next();\nif (event.operationType === "delete") {\n  const deleted = event;\n//      ^?\n}`,
    ).toBe("const deleted: DeleteEvent<Imaged, Record<never, never>>");
  });

  test("keyset page items", () => {
    hover(
      `const page = await Articles.keysetPage({ sort: [["publishedAt", -1]], limit: 5, lean: true });\nconst items = page.items;\n//    ^?`,
    ).toContain("title: string");
  });

  test("a view", () => {
    hover(
      `const view = TypedView.define(connection, TopArticle, { on: Article, pipeline: (p) => p.project({ title: 1, score: 1 }) });\n//    ^?`,
    ).toBe("const view: TypedView<TopArticle>");
  });

  test("a materialized result", () => {
    hover("const totals = stateTotals(connection);\n//    ^?").toBe("const totals: Materialized<StateTotal>");
  });

  test("the sync report", () => {
    hover("const report = await connection.syncAll({ dryRun: true });\n//    ^?").toBe("const report: SyncReport");
  });
});

describe("readable errors (storage)", () => {
  test("a view pipeline missing a field of the view class names the field", () => {
    expectTypeError(
      `${HEAD}TypedView.define(connection, TopArticle, { on: Article, pipeline: (p) => p.project({ title: 1 }) });`,
      { dir: FIXTURES },
    ).toContain("check these fields");
  });

  test("a nullable keyset sort key is refused by name", () => {
    expectTypeError(`${HEAD}Articles.keysetPage({ sort: [["rank", 1]], limit: 1 });`, { dir: FIXTURES }).toContain(
      `"rank"`,
    );
  });
});
