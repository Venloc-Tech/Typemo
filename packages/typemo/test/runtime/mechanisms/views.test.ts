/*
 * Typed views on the real server (`TypedView`: created by `ensure`, read-only and lean, the
 * definition compared with the server's, hidden fields of the source never in the rows) and materialized
 * results (`$merge` by `_id` or by a unique field, `$out`, the unique-index check).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { CollectionOptionsError, ConfigurationError, TypedView } from "../../../src/index.ts";
import { Animal, Article, TopArticle } from "../../fixtures/mechanisms/storage-entities.ts";
import {
  animalNames,
  stateTotals,
  stateTotalsReplace,
  titleScores,
  topArticles,
} from "../../fixtures/mechanisms/storage-operations.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("s9_views");

/** Inserts three articles, one of them a draft. */
const seed = async () => {
  const Articles = t.connection.model(Article);
  await Articles.insertMany([
    { title: "a", publishedAt: new Date("2026-01-01"), score: 3, views: 1n, rank: null, state: "draft" },
    { title: "b", publishedAt: new Date("2026-01-02"), score: 7, views: 2n, rank: 1 },
    { title: "c", publishedAt: new Date("2026-01-03"), score: 9, views: 3n, rank: 2 },
  ]);
};

beforeEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("s9_")) await t.mongo.db.dropCollection(name);
  }
  await seed();
});

/**
 * The error a query (a thenable, not a promise) rejects with.
 * @param query The query to await.
 * @returns The error, or `undefined` when it resolved.
 */
const errorOf = async (query: PromiseLike<unknown>): Promise<unknown> => {
  try {
    await query;
    return undefined;
  } catch (error) {
    return error;
  }
};

describe("a view that does not exist is an error, not an empty result", () => {
  /**
   * A connection of its own database (a fresh view state: the view was never created or checked there).
   * @param suffix The database name suffix.
   * @returns The connection and its raw database.
   */
  const fresh = async (suffix: string) => {
    const name = `${t.mongo.dbName}_${suffix}`;
    const db = t.mongo.client.db(name);
    await db.dropDatabase();
    return { connection: t.client.db(name), db };
  };

  test("reads before the view exists fail with ConfigurationError; nothing is read", async () => {
    const { connection, db } = await fresh("noview");
    const view = topArticles(connection);
    t.commands.clear();
    const error = await view.find().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toContain('the view "s9_top_articles" does not exist');
    expect(String(await errorOf(view.countDocuments()))).toContain("does not exist");
    expect(String(await errorOf(view.aggregate((p) => p.match({}))))).toContain("does not exist");
    expect(t.commands.byName("find")).toEqual([]);
    await db.dropDatabase();
  });

  test("a view created elsewhere is found on the server once; drop() makes the next read check again", async () => {
    const { connection, db } = await fresh("elsewhere");
    await db.collection("s9_articles").insertOne({ title: "x", score: 8 });
    await db.createCollection("s9_top_articles", { viewOn: "s9_articles", pipeline: [{ $match: { score: 8 } }] });
    const view = topArticles(connection);
    expect((await view.find()).map((row) => row.title)).toEqual(["x"]);
    t.commands.clear();
    await view.find();
    /* found once: no listCollections before the next reads */
    expect(t.commands.byName("listCollections")).toEqual([]);
    expect(await view.drop()).toBe(true);
    expect(String(await errorOf(view.find()))).toContain("does not exist");
    await view.ensure();
    expect((await view.find()).map((row) => row.title)).toEqual(["x"]);
    await db.dropDatabase();
  });

  test("a regular collection under the view's name is not read as the view", async () => {
    const { connection, db } = await fresh("collview");
    await db.createCollection("s9_top_articles");
    const view = topArticles(connection);
    expect(await errorOf(view.findOne())).toBeInstanceOf(ConfigurationError);
    expect(String(await errorOf(view.findOne()))).toContain("is a collection, not the view");
    await db.dropDatabase();
  });
});

describe("TypedView", () => {
  test("ensure creates the view; reads are lean rows of the view class", async () => {
    const view = topArticles(t.connection);
    expect((await view.ensure()).result).toBe("created");
    /* cast: listCollections() info has no typed options */
    const stored = (await t.mongo.db.listCollections({ name: "s9_top_articles" }).toArray())[0] as unknown as {
      type: string;
      options: { viewOn: string; pipeline: unknown[] };
    };
    expect(stored.type).toBe("view");
    expect(stored.options.viewOn).toBe("s9_articles");
    const rows = await view.find().sort({ score: -1 });
    expect(rows.map((row) => [row.title, row.score])).toEqual([
      ["c", 9],
      ["b", 7],
    ]);
    expect(rows[0]).not.toBeInstanceOf(TopArticle);
    expect(await view.countDocuments({ score: { $gt: 8 } })).toBe(1);
    /* distinct has no order (on a view the server returns it in any order). */
    expect((await view.distinct("title")).sort()).toEqual(["b", "c"]);
    expect((await view.findOne({ title: "b" }))?.score).toBe(7);
    expect((await view.ensure()).result).toBe("unchanged");
  });

  test("another stored definition: an error without update, collMod with update", async () => {
    await t.mongo.db.createCollection("s9_top_articles", {
      viewOn: "s9_articles",
      pipeline: [{ $match: { score: 1 } }],
    });
    const view = topArticles(t.connection);
    const error = await view.ensure().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CollectionOptionsError);
    expect((await view.ensure({ dryRun: true })).differences.map((difference) => difference.option)).toEqual([
      "pipeline",
    ]);
    expect((await view.ensure({ update: true })).result).toBe("updated");
    expect(await view.countDocuments()).toBe(2);
  });

  test("a regular collection under the view's name is never touched; drop() only drops views", async () => {
    await t.mongo.db.createCollection("s9_top_articles");
    const view = topArticles(t.connection);
    expect(await view.ensure().catch((caught: unknown) => caught)).toBeInstanceOf(CollectionOptionsError);
    expect(await view.drop().catch((caught: unknown) => caught)).toBeInstanceOf(CollectionOptionsError);
    await t.mongo.db.dropCollection("s9_top_articles");
    expect(await view.drop()).toBe(false);
    await view.ensure();
    expect(await view.drop()).toBe(true);
  });

  test("the source's Hidden fields are removed in the stored pipeline", async () => {
    await t.connection.model(Animal).create({ name: "rex", secret: "s" });
    const view = animalNames(t.connection);
    expect(view.definition.pipeline[0]).toEqual({ $unset: ["secret"] });
    await view.ensure();
    const raw = await t.mongo.db.collection("s9_animal_names").find().toArray();
    expect(raw.map((row) => Object.keys(row).sort())).toEqual([["_id", "name"]]);
  });

  test("the same view defined twice differently on one connection is an error; views are listed", () => {
    topArticles(t.connection);
    expect(TypedView.isView(t.connection, "s9_top_articles")).toBe(true);
    expect(TypedView.of(t.connection).map((view) => view.definition.name)).toContain("s9_top_articles");
    expect(() =>
      TypedView.define(t.connection, TopArticle, { on: Article, pipeline: (p) => p.match({ score: 1 }) }),
    ).toThrow(ConfigurationError);
  });

  test("syncAll ensures the views and never creates a collection for a view class", async () => {
    const connection = t.client.db(`${t.mongo.dbName}_views_sync`);
    const db = t.mongo.client.db(`${t.mongo.dbName}_views_sync`);
    await db.dropDatabase();
    connection.model(Article);
    topArticles(connection);
    const report = await connection.syncAll();
    expect(report.failed).toBe(false);
    expect(report.views.map((entry) => [entry.view, entry.result?.result])).toEqual([["s9_top_articles", "created"]]);
    expect(report.collections.map((entry) => entry.collection)).toEqual(["s9_articles"]);
    expect(((await db.listCollections({ name: "s9_top_articles" }).toArray())[0] as { type: string }).type).toBe(
      "view",
    );
    await db.dropDatabase();
  });
});

describe("Materialized", () => {
  test("$merge by _id (default): refresh computes and upserts; a second refresh updates", async () => {
    const totals = stateTotals(t.connection);
    expect(totals.definition).toMatchObject({
      from: "s9_articles",
      into: "s9_state_totals",
      mode: "merge",
      on: ["_id"],
    });
    await totals.refresh();
    const rows = await totals.model.find().sort({ _id: 1 }).lean();
    expect(rows).toEqual([
      { _id: "draft", total: 3, count: 1 },
      { _id: "live", total: 16, count: 2 },
    ]);
    await t.connection.model(Article).updateMany({ state: "draft" }, { $set: { state: "live" } });
    await totals.refresh();
    /* $merge never empties the collection: "draft" stays with its last value. */
    expect(await totals.model.find().sort({ _id: 1 }).lean()).toEqual([
      { _id: "draft", total: 3, count: 1 },
      { _id: "live", total: 19, count: 3 },
    ]);
  });

  test("mode replace ($out) replaces the collection", async () => {
    const totals = stateTotalsReplace(t.connection);
    await totals.refresh();
    await t.connection.model(Article).updateMany({ state: "draft" }, { $set: { state: "live" } });
    await totals.refresh();
    expect(await totals.model.find().lean()).toEqual([{ _id: "live", total: 19, count: 3 }]);
  });

  test("$merge on a unique field: checked on the server first, then merged", async () => {
    const scores = titleScores(t.connection);
    const error = await scores.refresh().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(String((error as Error).message)).toContain("unique index");
    await scores.model.syncIndexes();
    await scores.refresh();
    expect((await scores.model.find().sort({ title: 1 }).lean()).map((row) => [row.title, row.score])).toEqual([
      ["a", 3],
      ["b", 7],
      ["c", 9],
    ]);
  });
});
