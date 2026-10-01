import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { BsonOptions, ProjectionPlanner, QueryError, SchemaCompiler } from "../../../src/internal.ts";
import { Member } from "../../fixtures/query/query-entities.ts";
import { IDS, models, seed } from "../../fixtures/query/seed.ts";

/*
 * Projections (Hidden excluded by default, `+field`, no mixing), sort and window, value queries, cursor,
 * explain, populate plans, and memoization — on the server.
 */

const mongo = MongoLifecycle.useMongo("query_reads", BsonOptions.apply({}));
const { Members, Articles, runner } = models(() => mongo.db);

beforeEach(async () => {
  await seed(mongo.db);
});

describe("projections on the server", () => {
  test("Hidden fields are left out by default, at the top and inside a subdocument", async () => {
    const ann = await Members.findById(IDS.ann).lean();
    expect(ann && "passwordHash" in ann).toBe(false);
    expect(ann?.profile && "secretNote" in ann.profile).toBe(false);
    expect(ann?.profile?.bio).toBe("hello");
    expect(ProjectionPlanner.effective(SchemaCompiler.compile(Member), undefined)).toEqual({
      passwordHash: 0,
      "profile.secretNote": 0,
    });
  });

  test("`+field` adds a Hidden field to the default set; an inclusion that names it includes it", async () => {
    const plus = await Members.findById(IDS.ann).select({ "+passwordHash": true }).lean();
    expect([plus?.passwordHash, plus?.name, plus?.profile && "secretNote" in plus.profile]).toEqual([
      "hash-ann",
      "Ann",
      false,
    ]);
    const only = await Members.findById(IDS.ann).select({ passwordHash: 1 }).lean();
    expect(only).toEqual({ _id: IDS.ann, passwordHash: "hash-ann" });
  });

  test("inclusion, exclusion, _id: 0, dotted inclusion", async () => {
    expect(await Members.findById(IDS.bob).select({ name: 1, _id: 0 }).lean()).toEqual({ name: "Bob" });
    const excluded = await Members.findById(IDS.bob).select({ profile: 0, counters: 0 }).lean();
    expect(excluded && ["profile" in excluded, "counters" in excluded, "name" in excluded]).toEqual([
      false,
      false,
      true,
    ]);
    expect(await Members.findById(IDS.ann).select({ "profile.address.city": 1 }).lean()).toEqual({
      _id: IDS.ann,
      profile: { address: { city: "Paris" } },
    });
  });

  test("$slice keeps the other fields, $elemMatch is an inclusion", async () => {
    const sliced = await Members.findById(IDS.ann)
      .select({ tags: { $slice: 1 } })
      .lean();
    expect([sliced?.tags, sliced?.name]).toEqual([["vip"], "Ann"]);
    const matched = await Articles.findById(IDS.first)
      .select({ revisions: { $elemMatch: { lines: { $gt: 20 } } } })
      .lean();
    expect(matched).toEqual({ _id: IDS.first, revisions: [{ lines: 40, scores: [9] }] });
  });

  test("textScore adds the score field and sorts by it", async () => {
    await mongo.db.collection("q_articles").createIndex({ title: "text" });
    const found = await Articles.find({ $text: { $search: "typed queries" } })
      .select({ title: 1 })
      .textScore("relevance", { sort: true })
      .lean();
    expect(found.map((article) => article.title)).toEqual(["Typed queries in MongoDB"]);
    expect(typeof found[0]?.relevance).toBe("number");
  });
});

describe("order, window, values", () => {
  test("sort (object and list of pairs), skip, limit", async () => {
    const byAge = await Members.find({ age: { $exists: true } })
      .sort({ age: -1 })
      .lean();
    expect(byAge.map((member) => member.name)).toEqual(["Ann", "Bob"]);
    const window = await Members.find()
      .sort([["name", 1]])
      .skip(1)
      .limit(1)
      .lean();
    expect(window.map((member) => member.name)).toEqual(["Bob"]);
  });

  test("countDocuments (with skip/limit), estimatedDocumentCount, distinct (arrays unwound), exists", async () => {
    expect(await Members.countDocuments({ tags: { $size: 0 } })).toBe(1);
    expect(await Members.countDocuments().skip(1).limit(1)).toBe(1);
    expect(await Members.estimatedDocumentCount()).toBe(3);
    expect((await Members.distinct("tags")).sort()).toEqual(["early", "new", "vip"]);
    expect((await Members.distinct("role", { age: { $exists: true } })).sort()).toEqual(["admin", "user"]);
    expect(await Members.exists({ name: "Bob" })).toEqual({ _id: IDS.bob });
    expect(await Members.exists({ name: "Nobody" })).toBeNull();
  });

  test("cursor streams the same documents as await", async () => {
    const names: string[] = [];
    for await (const member of Members.find().sort({ name: 1 }).lean().cursor()) names.push(member.name);
    expect(names).toEqual(["Ann", "Bob", "Eve"]);
  });

  test("explain returns the server's plan", async () => {
    const plan = await Members.find({ name: "Ann" }).explain("queryPlanner");
    expect(typeof plan.queryPlanner).toBe("object");
  });

  test("an unknown explain verbosity is a QueryError before anything is sent", async () => {
    /* as never: the type names the three levels; this is the call of a JavaScript caller. */
    expect(() => Members.find({ name: "Ann" }).explain("nope" as never)).toThrow(QueryError);
    expect(() => Members.find({ name: "Ann" }).explain("nope" as never)).toThrow(
      /explain: the verbosity is "queryPlanner"/,
    );
  });

  test("session, comment, timeoutMS, collation and hint reach the server", async () => {
    await mongo.db.collection("q_members").createIndex({ name: 1 }, { name: "by_name" });
    const session = mongo.client.startSession();
    try {
      const found = await Members.find({ name: "ann" })
        .session(session)
        .comment("stage 5")
        .timeoutMS(5_000)
        .collation({ locale: "en", strength: 2 })
        .lean();
      expect(found.map((member) => member.name)).toEqual(["Ann"]);
      const hinted = await Members.find({ name: "Bob" }).hint("by_name").lean();
      expect(hinted.map((member) => member.name)).toEqual(["Bob"]);
    } finally {
      await session.endSession();
    }
  });
});

describe("populate plans (runner: one level) and re-execution", () => {
  test("a ref, a ref array with match and select, a virtual", async () => {
    const ann = await Members.findById(IDS.ann).populate("bestFriend").lean();
    expect(ann?.bestFriend?.name).toBe("Bob");
    const favorites = await Members.findById(IDS.ann)
      .populate({ path: "favorites", match: { views: { $gt: 10 } }, select: { title: 1 } })
      .lean();
    expect(favorites?.favorites).toEqual([{ _id: IDS.first, title: "Typed queries in MongoDB" }]);
    const article = await Articles.findById(IDS.first).populate("notes").lean();
    expect(article?.notes.map((note) => note.body).sort()).toEqual(["great", "meh"]);
  });

  test("awaiting the same query again returns the same result without a new round trip; a new builder reads again", async () => {
    const query = Members.find({ age: { $exists: true } }).lean();
    const before = runner.runs.length;
    const first = await query;
    expect(first.length).toBe(2);
    await mongo.db.collection("q_members").updateOne({ _id: IDS.eve }, { $set: { age: 50 } });
    expect(await query).toBe(first);
    expect(runner.runs.length - before).toBe(1);
    expect((await query.sort({ name: 1 })).length).toBe(3);
    expect(runner.runs.length - before).toBe(2);
    expect(Object.isFrozen(query.build())).toBe(true);
  });

  test("orFail: no document is an error", async () => {
    await expect(Members.findOne({ name: "Nobody" }).orFail().lean().exec()).rejects.toThrow(/DocumentNotFound/);
  });
});
