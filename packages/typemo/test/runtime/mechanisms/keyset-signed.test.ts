/*
 * Keyset tokens signed with HMAC-SHA256 when the client has `keysetSecret`. The signature
 * is checked (constant time) BEFORE the payload is read; an unsigned, re-signed or edited token is a
 * KeysetTokenError before anything reaches the server; keys rotate (the first signs, every one verifies).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";
import { ConfigurationError, KeysetTokenError, type Model, TypemoClient } from "../../../src/index.ts";
import { Article } from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const KEY = "k".repeat(32);
const OLD_KEY = new Uint8Array(32).fill(7);
const t = ModelLifecycle.useTypemo("m12_keyset", { keysetSecret: KEY });
let Articles: Model<Article>;
let rotated: TypemoClient;
let unsigned: TypemoClient;

/**
 * A date in January 2026.
 * @param n The day of the month.
 * @returns The UTC midnight of that day.
 */
const day = (n: number) => new Date(Date.UTC(2026, 0, n));
/**
 * Reads the first page of two articles by publish date.
 * @param model The articles model.
 * @returns The cursor token of the next page.
 */
const firstPage = async (model: Model<Article>) =>
  (await model.keysetPage({ sort: [["publishedAt", 1]], limit: 2, lean: true })).nextCursor as string;

beforeAll(async () => {
  rotated = await TypemoClient.connect(MongoHarness.getUri(), { dbName: t.mongo.dbName, keysetSecret: [KEY, OLD_KEY] });
  unsigned = await TypemoClient.connect(MongoHarness.getUri(), { dbName: t.mongo.dbName });
});

afterAll(async () => {
  await rotated?.close();
  await unsigned?.close();
});

beforeEach(async () => {
  Articles = t.connection.model(Article);
  await Articles.insertMany(
    [1, 2, 3, 4, 5].map((d) => ({
      title: `t${d}`,
      publishedAt: day(d),
      score: d,
      views: 1n,
      rank: null,
      state: "live" as const,
    })),
  );
});

describe("signed keyset tokens", () => {
  test("a signed client pages normally; the token is <payload>.<signature>", async () => {
    const after = await firstPage(Articles);
    expect(after).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const page = await Articles.keysetPage({ sort: [["publishedAt", 1]], limit: 2, after, lean: true });
    expect(page.items.map((item) => item.title)).toEqual(["t3", "t4"]);
  });

  test("an edited payload, a forged signature, an unsigned token: KeysetTokenError, nothing sent", async () => {
    const after = await firstPage(Articles);
    const [payload, signature] = after.split(".") as [string, string];
    const text = Buffer.from(payload, "base64url").toString("utf8");
    /* Move the position one millisecond: a valid payload the signature does not cover. */
    const edited = Buffer.from(text.replace(/(\d)(?=\D*$)/, (digit) => String((Number(digit) + 1) % 10))).toString(
      "base64url",
    );
    expect(edited).not.toBe(payload);
    t.commands.clear();
    const refuse = (token: string) =>
      Articles.keysetPage({ sort: [["publishedAt", 1]], limit: 2, after: token, lean: true });
    await expect(refuse(`${edited}.${signature}`)).rejects.toThrow(/the signature is not valid/);
    await expect(refuse(`${payload}.${"A".repeat(43)}`)).rejects.toThrow(/the signature is not valid/);
    await expect(refuse(payload)).rejects.toThrow(/it is not signed/);
    await expect(refuse(payload)).rejects.toBeInstanceOf(KeysetTokenError);
    expect(t.commands.byName("find").length).toBe(0);
  });

  test("rotation: a client with [new, old] verifies both and signs with the new one", async () => {
    const oldClient = await TypemoClient.connect(MongoHarness.getUri(), {
      dbName: t.mongo.dbName,
      keysetSecret: OLD_KEY,
    });
    try {
      const oldToken = await firstPage(oldClient.connection.model(Article));
      const Rotated = rotated.connection.model(Article);
      const page = await Rotated.keysetPage({ sort: [["publishedAt", 1]], limit: 2, after: oldToken, lean: true });
      expect(page.items.map((item) => item.title)).toEqual(["t3", "t4"]);
      /* The rotated client signs with KEY: the current client (KEY only) accepts it. */
      const next = page.nextCursor as string;
      const again = await Articles.keysetPage({ sort: [["publishedAt", 1]], limit: 2, after: next, lean: true });
      expect(again.items.map((item) => item.title)).toEqual(["t5"]);
    } finally {
      await oldClient.close();
    }
  });

  test("a signed token given to a client without a key is refused (not silently accepted)", async () => {
    const after = await firstPage(Articles);
    await expect(
      unsigned.connection.model(Article).keysetPage({ sort: [["publishedAt", 1]], limit: 2, after, lean: true }),
    ).rejects.toThrow(/it is signed, but this client has no keysetSecret/);
  });

  test("keys: shorter than 32 bytes, an empty list, another type — ConfigurationError; the key is copied", () => {
    expect(() => new TypemoClient("mongodb://localhost", { keysetSecret: "short" })).toThrow(ConfigurationError);
    expect(() => new TypemoClient("mongodb://localhost", { keysetSecret: [] })).toThrow(ConfigurationError);
    expect(() => new TypemoClient("mongodb://localhost", { keysetSecret: 5 as never })).toThrow(ConfigurationError);
    const key = new Uint8Array(32).fill(1);
    const client = new TypemoClient("mongodb://localhost", { keysetSecret: key });
    key.fill(2); /* the caller's buffer changing later does not change the client's key */
    expect([...(client.options.keysetSecrets[0] ?? [])]).toEqual(new Array(32).fill(1));
  });
});
