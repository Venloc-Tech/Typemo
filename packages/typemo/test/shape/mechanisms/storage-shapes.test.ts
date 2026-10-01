import { beforeEach, describe, test } from "bun:test";
import { expectShapeMatches } from "@venloc/typemo-test-kit";
import { Article, Imaged } from "../../fixtures/mechanisms/storage-entities.ts";
import {
  type StorageOperations,
  stateTotals,
  storageOperations,
  topArticles,
} from "../../fixtures/mechanisms/storage-operations.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/*
 * The result types the compiler computes for the storage APIs against the shape of what they return from the
 * server — view rows (lean), a materialized collection, keyset pages (lean and hydrated), change events per
 * operation type (with and without images).
 */

const t = ModelLifecycle.useTypemo("s9_shape");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
let ops: StorageOperations;

beforeEach(async () => {
  const Articles = t.connection.model(Article);
  const Imageds = t.connection.model(Imaged);
  await Imageds.ensureCollection();
  await Articles.insertMany([
    { title: "a", publishedAt: new Date("2026-01-01"), score: 3, views: 1n, rank: null, state: "draft" },
    { title: "b", publishedAt: new Date("2026-01-02"), score: 7, views: 2n, rank: 1, subtitle: "s" },
    { title: "c", publishedAt: new Date("2026-01-03"), score: 9, views: 3n, rank: 2 },
  ]);
  await topArticles(t.connection).ensure();
  await stateTotals(t.connection).refresh();
  ops = storageOperations(t.connection, Articles, Imageds);
});

/** The shape-harness target: the awaited result type of `name`, followed by the type-level `path`. */
const target = (name: keyof StorageOperations, path = "") => ({
  code: `
import type { StorageOperations } from "./mechanisms/storage-operations.ts";
type Result = Awaited<ReturnType<StorageOperations["${name}"]>>;
export type Shape = NonNullable<Result>${path};
`,
  type: "Shape",
  dir: FIXTURES,
});

describe("shape: storage result types vs the server's results", () => {
  /* A thunk per row: indexing `ops[name]` with a union of names builds every result type at once (TS2589). */
  const rows: readonly (readonly [keyof StorageOperations, string, string, () => Promise<unknown>])[] = [
    ["viewRows", "view find: lean rows of the view class", "[number]", async () => (await ops.viewRows())[0]],
    ["viewOne", "view findOne: one lean row", "", async () => await ops.viewOne()],
    ["materializedRows", "materialized model: lean rows", "[number]", async () => (await ops.materializedRows())[0]],
    ["keysetLean", "keysetPage lean: items", '["items"][number]', async () => (await ops.keysetLean()).items[0]],
    [
      "keysetHydrated",
      "keysetPage hydrated: items",
      '["items"][number]',
      async () => (await ops.keysetHydrated()).items[0],
    ],
    ["insertEvent", "insert event: lean fullDocument, documentKey", "", () => ops.insertEvent()],
    ["updateEvent", "update event with both images", "", () => ops.updateEvent()],
    ["deleteEvent", "delete event without a pre-image", "", () => ops.deleteEvent()],
  ];
  for (const [name, what, path, run] of rows) {
    test(`${name}: ${what}`, async () => {
      expectShapeMatches(target(name, path), await run());
    });
  }
});
