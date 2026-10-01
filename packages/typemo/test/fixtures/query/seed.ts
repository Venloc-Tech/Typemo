/*
 * Seed data of the query tests: stored documents written straight through the driver (no casting
 * involved), and the typed entry points over a `PlanRunner`.
 */
import { type Db, Decimal128, ObjectId } from "mongodb";
import { ModelOperations } from "../../../src/internal.ts";
import { PlanRunner } from "./plan-runner.ts";
import { Article, Member, Note } from "./query-entities.ts";

/** Fixed ids of the seeded documents. */
export const IDS = {
  ann: new ObjectId(),
  bob: new ObjectId(),
  eve: new ObjectId(),
  first: new ObjectId(),
  second: new ObjectId(),
  note1: new ObjectId(),
  note2: new ObjectId(),
} as const;

/** The stored member documents: a full one, one with nulls and empty containers, and a minimal one. */
export const MEMBERS = [
  {
    _id: IDS.ann,
    name: "Ann",
    email: "ann@example.test",
    passwordHash: "hash-ann",
    role: "admin",
    age: 34,
    visits: 10n,
    balance: Decimal128.fromString("10.50"),
    active: true,
    tags: ["vip", "early"],
    profile: {
      bio: "hello",
      address: { city: "Paris", zip: "75001", geo: { type: "Point", coordinates: [2.35, 48.85] } },
      links: [
        { url: "https://github.com/ann", clicks: 3 },
        { url: "https://example.test", clicks: 0 },
      ],
      secretNote: "ann's secret",
    },
    counters: { logins: 5, posts: 2 },
    badges: { gold: { title: "Champion", level: 3 }, silver: { title: "Runner-up" } },
    bestFriend: IDS.bob,
    favorites: [IDS.first, IDS.second],
    lastLogin: new Date("2026-01-02T00:00:00Z"),
  },
  {
    _id: IDS.bob,
    name: "Bob",
    email: "bob@example.test",
    role: "user",
    age: 17,
    visits: 1n,
    active: false,
    tags: ["new"],
    profile: { links: [], address: { city: "Berlin", zip: null } },
    counters: { logins: 1 },
    bestFriend: null,
    favorites: [],
    lastLogin: null,
  },
  {
    _id: IDS.eve,
    name: "Eve",
    email: "eve@example.test",
    role: "editor",
    tags: [],
  },
] as const;

/** The stored article documents (one published with revisions and blocks, one draft). */
export const ARTICLES = [
  {
    _id: IDS.first,
    title: "Typed queries in MongoDB",
    author: IDS.ann,
    revisions: [
      { note: "draft", lines: 10, scores: [1, 5] },
      { lines: 40, scores: [9] },
    ],
    blocks: [
      { kind: "text", text: "intro" },
      { kind: "image", url: "https://img.test/a.png", width: 640 },
    ],
    tags: ["mongodb", "typescript"],
    views: 120,
    publishedAt: new Date("2026-03-01T00:00:00Z"),
  },
  {
    _id: IDS.second,
    title: "Drafts",
    author: IDS.bob,
    revisions: [],
    blocks: [{ kind: "text", text: "only text" }],
    tags: [],
    views: 0,
    publishedAt: null,
  },
] as const;

/** The stored note documents (both on the first article). */
export const NOTES = [
  { _id: IDS.note1, body: "great", article: IDS.first, score: 5 },
  { _id: IDS.note2, body: "meh", article: IDS.first, score: 2 },
] as const;

/**
 * Writes the seed documents (shallow copies: the driver never changes documents that have an `_id`).
 *
 * @param db - the test database
 */
export const seed = async (db: Db): Promise<void> => {
  await db.collection("q_members").insertMany(MEMBERS.map((doc) => ({ ...doc })));
  await db.collection("q_articles").insertMany(ARTICLES.map((doc) => ({ ...doc })));
  await db.collection("q_notes").insertMany(NOTES.map((doc) => ({ ...doc })));
};

/**
 * The typed entry points of the three models over one runner.
 *
 * @param db - returns the test database (read lazily, when an operation runs)
 * @returns the runner and one `ModelOperations` per model
 */
export const models = (db: () => Db) => {
  const runner = new PlanRunner(db);
  return {
    runner,
    Members: new ModelOperations(Member, runner),
    Articles: new ModelOperations(Article, runner),
    Notes: new ModelOperations(Note, runner),
  };
};
