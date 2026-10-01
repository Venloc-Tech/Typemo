/*
 * Frozen inputs work and are left as they were — watch options and pipelines, keyset options (sort pairs,
 * filter), ensureCollection/syncAll options, view and materialized definitions.
 */
import { describe, expect, test } from "bun:test";
import { fn, Materialized, TypedView } from "../../../src/index.ts";
import { Article, Imaged, StateTotal, TopArticle } from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("s9_nomut");

/** Freezes `value` and everything reachable from it. */
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};

/** A stable JSON text of `value` (bigint-safe) to compare before and after. */
const snapshot = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? `${v}n` : v));

describe("no input mutation (storage)", () => {
  test("watch options", async () => {
    const Imageds = t.connection.model(Imaged);
    await Imageds.ensureCollection();
    const options = deepFreeze({ fullDocument: "updateLookup" as const, batchSize: 10 });
    const before = snapshot(options);
    const stream = await Imageds.watch((p) => p.match({ operationType: "insert" }), options);
    await stream.close();
    expect(snapshot(options)).toBe(before);
  });

  test("keysetPage options", async () => {
    const Articles = t.connection.model(Article);
    const options = deepFreeze({
      filter: { score: { $gte: 0 } },
      sort: [["publishedAt", -1]] as const,
      limit: 2,
      lean: true as const,
    });
    const before = snapshot(options);
    await Articles.keysetPage(options);
    expect(snapshot(options)).toBe(before);
  });

  test("ensureCollection and syncAll options", async () => {
    const options = deepFreeze({ dryRun: true });
    await t.connection.model(Article).ensureCollection(options);
    await t.connection.syncAll(options);
    expect(options).toEqual({ dryRun: true });
  });

  test("view and materialized definitions", () => {
    const collation = deepFreeze({ locale: "en" });
    const view = TypedView.define(t.connection, TopArticle, {
      on: Article,
      pipeline: (p) => p.match({ score: { $gte: 5 } }).project({ title: 1, score: 1 }),
      collation,
    });
    expect(view.definition.collation).toEqual({ locale: "en" });
    expect(Object.isFrozen(view.definition)).toBe(true);
    const materialized = Materialized.define(t.connection, StateTotal, {
      from: Article,
      pipeline: (p) => p.group((f) => ({ _id: f.state, total: fn.sum(f.score), count: fn.sum(1) })),
    });
    expect(Object.isFrozen(materialized.definition.pipeline)).toBe(true);
  });
});
