/*
 * The public `@venloc/typemo/testing` entry point, smoke-tested through the package
 * name (as a user imports it): typed factories and the query-plan assertions on the real server.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  defineFactory,
  expectCollScan,
  expectIndexScan,
  explainIndexUsage,
  IndexUsageError,
} from "@venloc/typemo/testing";
import { fn } from "../../../src/index.ts";
import { Article } from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("s9_testing");

beforeEach(async () => {
  await t.mongo.db
    .collection("s9_articles")
    .drop()
    .catch(() => undefined);
});

describe("defineFactory", () => {
  test("build / buildMany / create / createMany / reset, overrides as an object or a function", async () => {
    const Articles = t.connection.model(Article);
    const articles = defineFactory(Articles, (n) => ({
      title: `t${n}`,
      publishedAt: new Date(Date.UTC(2026, 0, n)),
      score: n,
      views: BigInt(n),
      rank: null,
    }));
    expect(articles.build().title).toBe("t1");
    const overrides = Object.freeze({ score: 100 });
    expect(articles.build(overrides)).toMatchObject({ title: "t2", score: 100 });
    expect(articles.buildMany(2, (n) => ({ title: `x${n}` })).map((doc) => doc.title)).toEqual(["x3", "x4"]);
    articles.reset();
    const created = await articles.create();
    expect(created).toBeInstanceOf(Article);
    expect(created.title).toBe("t1");
    const many = await articles.createMany(2);
    expect(many.map((doc) => doc.title)).toEqual(["t2", "t3"]);
    expect(await Articles.countDocuments()).toBe(3);
    expect(() => articles.buildMany(-1)).toThrow();
  });
});

describe("expectIndexScan / expectCollScan", () => {
  beforeEach(async () => {
    const Articles = t.connection.model(Article);
    await Articles.syncIndexes();
    await Articles.insertMany(
      Array.from({ length: 20 }, (_, n) => ({
        title: `t${n}`,
        publishedAt: new Date(Date.UTC(2026, 0, n + 1)),
        score: n,
        views: BigInt(n),
        rank: null,
      })),
    );
  });

  test("a find served by the declared index; the index name is checked", async () => {
    const Articles = t.connection.model(Article);
    const usage = await expectIndexScan(Articles.find({ publishedAt: { $gte: new Date(Date.UTC(2026, 0, 15)) } }), {
      index: "publishedAt_-1__id_-1",
      maxDocsExamined: 6,
    });
    expect(usage.usesIndex).toBe(true);
    expect(usage.docsReturned).toBe(6);
  });

  test("a scan is an IndexUsageError with the plan; expectCollScan accepts it", async () => {
    const Articles = t.connection.model(Article);
    const error = await expectIndexScan(Articles.find({ title: "t3" })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IndexUsageError);
    expect((error as IndexUsageError).usage.collectionScan).toBe(true);
    expect((await expectCollScan(Articles.find({ title: "t3" }))).docsExamined).toBe(20);
    await expect(expectCollScan(Articles.find({ publishedAt: new Date(Date.UTC(2026, 0, 3)) }))).rejects.toThrow(
      IndexUsageError,
    );
  });

  test("an express plan that reads the document is not covered; a projection on the index keys is", async () => {
    const Articles = t.connection.model(Article);
    const first = await Articles.findOne({ title: "t3" }).orFail();
    const usage = await explainIndexUsage(Articles.find({ _id: first._id }));
    expect(usage.usesIndex).toBe(true);
    expect(usage.docsExamined).toBe(1);
    expect(usage.covered).toBe(false);
    await expect(expectIndexScan(Articles.find({ _id: first._id }), { covered: true })).rejects.toThrow(
      "it is not covered by the index",
    );
    const covered = await expectIndexScan(
      Articles.find({ publishedAt: { $gte: new Date(Date.UTC(2026, 0, 18)) } }).select({ publishedAt: 1, _id: 1 }),
      { covered: true },
    );
    expect(covered.docsExamined).toBe(0);
  });

  test("an aggregation's plan is read too", async () => {
    const Articles = t.connection.model(Article);
    const aggregation = Articles.aggregate((p) =>
      p.match({ publishedAt: { $gte: new Date(Date.UTC(2026, 0, 18)) } }).group(() => ({ _id: null, n: fn.sum(1) })),
    );
    const usage = await explainIndexUsage(aggregation);
    expect(usage.usesIndex).toBe(true);
    expect(usage.indexes).toEqual(["publishedAt_-1__id_-1"]);
  });
});
