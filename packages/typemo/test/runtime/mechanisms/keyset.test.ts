/*
 * Keyset pagination on the real server — a total order with the `_id` tiebreak (ties never
 * repeat or skip), rows added between pages, filters, several keys, bigint keys, lean/hydrated, and the
 * token as UNTRUSTED input: tampered, truncated, of another sort, with operators or wrong types — all
 * refused with `KeysetTokenError` before anything reaches the server.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { EJSON, ObjectId } from "bson";
import {
  ConfigurationError,
  type KeysetPage,
  KeysetTokenError,
  type LeanOf,
  type Model,
  QueryError,
} from "../../../src/index.ts";
import { TimedPost } from "../../fixtures/mechanisms/keyset-entities.ts";
import { Article } from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("s9_keyset");
let Articles: Model<Article>;

/**
 * A date in January 2026.
 * @param n The day of the month.
 * @returns The UTC midnight of that day.
 */
const day = (n: number) => new Date(Date.UTC(2026, 0, n));
/**
 * Builds a keyset token by hand from an arbitrary value.
 * @param value The payload to encode.
 * @returns The base64url EJSON token.
 */
const token = (value: unknown) => Buffer.from(EJSON.stringify(value, { relaxed: false }), "utf8").toString("base64url");

beforeEach(async () => {
  await t.mongo.db
    .collection("s9_articles")
    .drop()
    .catch(() => undefined);
  Articles = t.connection.model(Article);
  /* Three rows share publishedAt day(2): only the _id tiebreak orders them. */
  await Articles.insertMany(
    [1, 2, 2, 2, 3, 4, 5].map((d, index) => ({
      title: `t${index}`,
      publishedAt: day(d),
      score: index % 3,
      views: BigInt(index) * 10n ** 15n,
      rank: null,
      state: index === 0 ? ("draft" as const) : ("live" as const),
    })),
  );
});

/**
 * Walks every page of a keyset pagination.
 * @param sort The sort keys.
 * @param limit The page size.
 * @returns The titles of all rows in page order.
 */
const allPages = async (sort: Parameters<Model<Article>["keysetPage"]>[0]["sort"], limit: number) => {
  const titles: string[] = [];
  let after: string | null = null;
  let pages = 0;
  do {
    const page: Awaited<ReturnType<Model<Article>["keysetPage"]>> = await Articles.keysetPage({
      sort,
      limit,
      after,
      lean: true,
    });
    titles.push(...page.items.map((item) => item.title));
    after = page.nextCursor;
    pages += 1;
    expect(page.hasMore).toBe(after !== null);
  } while (after !== null && pages < 20);
  return titles;
};

describe("keysetPage", () => {
  test("pages through every row once, ties ordered by _id (desc like the last key)", async () => {
    const expected = (await Articles.find().sort({ publishedAt: -1, _id: -1 }).lean()).map((row) => row.title);
    expect(await allPages([["publishedAt", -1]], 2)).toEqual(expected);
    expect(await allPages([["publishedAt", "desc"]], 3)).toEqual(expected);
  });

  test("several keys and a bigint key", async () => {
    const expected = (await Articles.find().sort({ score: 1, publishedAt: -1, _id: -1 }).lean()).map(
      (row) => row.title,
    );
    expect(
      await allPages(
        [
          ["score", 1],
          ["publishedAt", -1],
        ],
        2,
      ),
    ).toEqual(expected);
    const byViews = (await Articles.find().sort({ views: 1, _id: 1 }).lean()).map((row) => row.title);
    expect(await allPages([["views", 1]], 3)).toEqual(byViews);
  });

  test("a row added before the position does not shift the next page", async () => {
    const first = await Articles.keysetPage({ sort: [["publishedAt", 1]], limit: 3, lean: true });
    await Articles.create({ title: "early", publishedAt: day(0), score: 0, views: 0n, rank: null });
    const second = await Articles.keysetPage({
      sort: [["publishedAt", 1]],
      limit: 3,
      after: first.nextCursor,
      lean: true,
    });
    const all = [...first.items, ...second.items].map((item) => item.title);
    expect(new Set(all).size).toBe(6);
    expect(all).not.toContain("early");
  });

  test("with a filter; hydrated documents by default", async () => {
    const page = await Articles.keysetPage({ filter: { state: "live" }, sort: [["publishedAt", 1]], limit: 10 });
    expect(page.items.length).toBe(6);
    expect(page.items[0]).toBeInstanceOf(Article);
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  test("the sort keys must be required, non-nullable fields; limit a positive integer", async () => {
    await expect(Articles.keysetPage({ sort: [["rank" as never, 1]], limit: 1 })).rejects.toThrow(ConfigurationError);
    await expect(Articles.keysetPage({ sort: [["subtitle" as never, 1]], limit: 1 })).rejects.toThrow(
      ConfigurationError,
    );
    await expect(Articles.keysetPage({ sort: [["publishedAt", 1]], limit: 0 })).rejects.toThrow(QueryError);
    await expect(Articles.keysetPage({ sort: [] as never, limit: 1 })).rejects.toThrow(QueryError);
  });
});

describe("the token is untrusted input", () => {
  const sort = [["publishedAt", 1]] as const;
  /**
   * The token of the second page.
   * @returns The cursor token.
   */
  const next = async () => (await Articles.keysetPage({ sort: [["publishedAt", 1]], limit: 2 })).nextCursor as string;
  /**
   * Asserts that a token is refused.
   * @param after The token to try.
   * @returns The `KeysetTokenError` that was thrown.
   */
  const rejects = async (after: string) => {
    const error = await Articles.keysetPage({ sort, limit: 2, after }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KeysetTokenError);
    return error as KeysetTokenError;
  };

  test("a valid token round-trips (EJSON: dates and ObjectIds keep their types)", async () => {
    const after = await next();
    const parsed = EJSON.parse(Buffer.from(after, "base64url").toString("utf8"), { relaxed: true }) as {
      k: unknown;
      x: unknown[];
    };
    expect(parsed.k).toEqual([
      ["publishedAt", 1],
      ["_id", 1],
    ]);
    expect(parsed.x[0]).toBeInstanceOf(Date);
    expect(parsed.x[1]).toBeInstanceOf(ObjectId);
  });

  test("tampered bytes, truncation, another alphabet, huge input", async () => {
    const after = await next();
    await rejects(`${after.slice(0, -4)}AAAA`);
    await rejects(after.slice(0, 10));
    await rejects(`${after}!`);
    await rejects("A".repeat(5000));
    await rejects("");
  });

  test("a token of another sort, extra fields, an unknown version", async () => {
    await rejects(
      token({
        v: 1,
        k: [
          ["score", 1],
          ["_id", 1],
        ],
        x: [1, new ObjectId()],
      }),
    );
    await rejects(
      token({
        v: 1,
        k: [
          ["publishedAt", -1],
          ["_id", -1],
        ],
        x: [day(1), new ObjectId()],
      }),
    );
    await rejects(
      token({
        v: 1,
        k: [
          ["publishedAt", 1],
          ["_id", 1],
        ],
        x: [day(1), new ObjectId()],
        extra: 1,
      }),
    );
    await rejects(
      token({
        v: 2,
        k: [
          ["publishedAt", 1],
          ["_id", 1],
        ],
        x: [day(1), new ObjectId()],
      }),
    );
  });

  test("operators and objects instead of values, wrong types, null", async () => {
    const error = await rejects(
      token({
        v: 1,
        k: [
          ["publishedAt", 1],
          ["_id", 1],
        ],
        x: [{ $ne: null }, new ObjectId()],
      }),
    );
    expect(error.message).toContain("not a scalar");
    await rejects(
      token({
        v: 1,
        k: [
          ["publishedAt", 1],
          ["_id", 1],
        ],
        x: [day(1), { $gt: "" }],
      }),
    );
    await rejects(
      token({
        v: 1,
        k: [
          ["publishedAt", 1],
          ["_id", 1],
        ],
        x: [day(1), true],
      }),
    );
    await rejects(
      token({
        v: 1,
        k: [
          ["publishedAt", 1],
          ["_id", 1],
        ],
        x: [null, new ObjectId()],
      }),
    );
    await rejects(
      token({
        v: 1,
        k: [
          ["publishedAt", 1],
          ["_id", 1],
        ],
        x: [[day(1)], new ObjectId()],
      }),
    );
  });
});

describe("keysetPage over the timestamps of Timestamped", () => {
  let Posts: Model<TimedPost>;

  beforeEach(async () => {
    await t.mongo.db
      .collection("s9_timed_posts")
      .drop()
      .catch(() => undefined);
    Posts = t.connection.model(TimedPost);
    /* One row per insert: distinct createdAt values, and ties (same millisecond) ordered by _id. */
    for (let n = 0; n < 7; n += 1) await Posts.create({ title: `p${n}` });
  });

  test("newest first by createdAt: every row once, in the order of find().sort()", async () => {
    const expected = (await Posts.find().sort({ createdAt: -1, _id: -1 }).lean()).map((row) => row.title);
    expect(expected).toHaveLength(7);
    const titles: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const page: KeysetPage<LeanOf<TimedPost>> = await Posts.keysetPage({
        sort: [["createdAt", -1]],
        limit: 3,
        after,
        lean: true,
      });
      titles.push(...page.items.map((item) => item.title));
      after = page.nextCursor;
      pages += 1;
    } while (after !== null && pages < 10);
    expect(pages).toBe(3);
    expect(titles).toEqual(expected);
  });

  test("updatedAt is a sort key too", async () => {
    const page = await Posts.keysetPage({ sort: [["updatedAt", 1]], limit: 10, lean: true });
    expect(page.items.map((item) => item.title)).toEqual(
      (await Posts.find().sort({ updatedAt: 1, _id: 1 }).lean()).map((row) => row.title),
    );
  });

  test("an optional boolean has the same error as another optional field", async () => {
    const message = async (key: string) =>
      (await Posts.keysetPage({ sort: [[key as never, 1]], limit: 1 }).catch((error: unknown) => error)) as Error;
    const draft = await message("draft");
    const note = await message("note");
    expect(draft).toBeInstanceOf(ConfigurationError);
    expect(draft.message).toBe(
      'keysetPage: sort "draft" of TimedPost must be required and not nullable (a missing value cannot be a position)',
    );
    expect(note.message).toBe(
      'keysetPage: sort "note" of TimedPost must be required and not nullable (a missing value cannot be a position)',
    );
  });
});
