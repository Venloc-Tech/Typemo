import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { Decimal128, type Document, ObjectId } from "mongodb";
import { BsonOptions, QueryError, type UpdateInput } from "../../../src/index.ts";
import type { Member } from "../../fixtures/query/query-entities.ts";
import { IDS, models, seed } from "../../fixtures/query/seed.ts";

/* Every update the types accept is accepted by the server and does what it says. */

const mongo = MongoLifecycle.useMongo("query_updates", BsonOptions.apply({}));
const { Members, Articles } = models(() => mongo.db);

beforeEach(async () => {
  await seed(mongo.db);
});

/**
 * Reads a member straight from the collection.
 * @param id The member id.
 * @returns The stored raw document, or null.
 */
const member = (id: ObjectId): Promise<Document | null> => mongo.db.collection("q_members").findOne({ _id: id });
/**
 * Reads an article straight from the collection.
 * @param id The article id.
 * @returns The stored raw document, or null.
 */
const article = (id: ObjectId): Promise<Document | null> => mongo.db.collection("q_articles").findOne({ _id: id });

describe("update operators on the server", () => {
  test("$set: fields, dotted paths, null on a nullable path; the result's upsertedId is null", async () => {
    const result = await Members.updateOne(
      { _id: IDS.ann },
      { $set: { name: "Anna", "profile.bio": "hi", "profile.address.zip": null, bestFriend: null } },
    );
    expect(result).toMatchObject({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    });
    const doc = await member(IDS.ann);
    expect([doc?.name, doc?.profile.bio, doc?.profile.address.zip, doc?.bestFriend]).toEqual([
      "Anna",
      "hi",
      null,
      null,
    ]);
  });

  test("positional $, $[] and $[id] with typed arrayFilters, at any depth", async () => {
    await Members.updateOne({ _id: IDS.ann, "profile.links.clicks": 3 }, { $set: { "profile.links.$.clicks": 4 } });
    expect((await member(IDS.ann))?.profile.links[0].clicks).toBe(4);
    await Articles.updateOne({ _id: IDS.first }, { $inc: { "revisions.$[].lines": 1 } });
    expect((await article(IDS.first))?.revisions.map((r: Document) => r.lines)).toEqual([11, 41]);
    await Articles.updateOne(
      { _id: IDS.first },
      { $set: { "revisions.$[r].note": "long" } },
      { arrayFilters: [{ "r.lines": { $gt: 20 } }] },
    );
    expect((await article(IDS.first))?.revisions.map((r: Document) => r.note)).toEqual(["draft", "long"]);
    await Articles.updateOne(
      { _id: IDS.first },
      { $set: { "revisions.$[r].scores.$[s]": 0 } },
      { arrayFilters: [{ "r.lines": { $lt: 20 } }, { s: { $gte: 5 } }] },
    );
    expect((await article(IDS.first))?.revisions[0].scores).toEqual([1, 0]);
    await Articles.updateOne({ _id: IDS.first }, { $set: { "blocks.1.width": 800 } });
    expect((await article(IDS.first))?.blocks[1].width).toBe(800);
  });

  test("Map entries and fields inside Map values", async () => {
    await Members.updateOne(
      { _id: IDS.ann },
      { $inc: { "counters.logins": 1 }, $set: { "badges.gold.title": "Legend", "badges.bronze": { title: "Third" } } },
    );
    const doc = await member(IDS.ann);
    expect([doc?.counters.logins, doc?.badges.gold.title, doc?.badges.bronze.title]).toEqual([6, "Legend", "Third"]);
    await Members.updateOne({ _id: IDS.ann }, { $unset: { "badges.silver": 1 } });
    expect(Object.keys((await member(IDS.ann))?.badges ?? {})).toEqual(["gold", "bronze"]);
  });

  test("$inc / $mul on number, bigint (int64 stays int64) and Decimal128", async () => {
    await Members.updateOne(
      { _id: IDS.ann },
      { $inc: { age: 1, visits: 5n, balance: Decimal128.fromString("0.25") }, $mul: { "profile.links.0.clicks": 2 } },
    );
    const doc = await member(IDS.ann);
    expect([doc?.age, doc?.visits, doc?.balance.toString(), doc?.profile.links[0].clicks]).toEqual([
      35,
      15n,
      "10.75",
      6,
    ]);
    const stored = await mongo.db.collection("q_members").countDocuments({ _id: IDS.ann, visits: { $type: "long" } });
    expect(stored).toBe(1);
  });

  test("$min / $max, $currentDate, $rename, $unset (optional only), $bit", async () => {
    await Members.updateOne({ _id: IDS.ann }, { $min: { age: 30 }, $max: { visits: 100n } });
    await Members.updateOne({ _id: IDS.bob }, { $currentDate: { lastLogin: true }, $unset: { age: 1 } });
    await Members.updateOne({ _id: IDS.ann }, { $bit: { age: { or: 1 } } });
    const ann = await member(IDS.ann);
    const bob = await member(IDS.bob);
    expect([ann?.age, ann?.visits]).toEqual([31, 100n]);
    expect(bob?.lastLogin).toBeInstanceOf(Date);
    expect("age" in (bob ?? {})).toBe(false);
  });

  test("$rename between two optional paths of the same type", async () => {
    await mongo.db.collection("q_members").updateOne({ _id: IDS.eve }, { $set: { nickname: "evie" } });
    await Members.updateOne({ _id: IDS.eve }, { $rename: { nickname: "handle" } });
    const doc = await member(IDS.eve);
    expect([doc?.nickname, doc?.handle]).toEqual([undefined, "evie"]);
  });

  test("$push with $each/$position/$slice/$sort (typed by the element), $addToSet, $pull, $pullAll, $pop", async () => {
    await Members.updateOne(
      { _id: IDS.ann },
      {
        $push: {
          "profile.links": { $each: [{ url: "https://z.test", clicks: 9 }], $sort: { clicks: -1 }, $slice: 2 },
          tags: { $each: ["first"], $position: 0 },
        },
      },
    );
    let doc = await member(IDS.ann);
    expect(doc?.profile.links.map((link: Document) => link.clicks)).toEqual([9, 3]);
    expect(doc?.tags).toEqual(["first", "vip", "early"]);
    await Members.updateOne({ _id: IDS.ann }, { $addToSet: { tags: { $each: ["vip", "late"] } } });
    await Members.updateOne({ _id: IDS.ann }, { $pull: { "profile.links": { clicks: { $lt: 5 } } } });
    await Members.updateOne({ _id: IDS.ann }, { $pullAll: { tags: ["first"] } });
    await Members.updateOne({ _id: IDS.ann }, { $pop: { tags: 1 } });
    doc = await member(IDS.ann);
    expect(doc?.tags).toEqual(["vip", "early"]);
    expect(doc?.profile.links.map((link: Document) => link.url)).toEqual(["https://z.test"]);
    await Articles.updateOne(
      { _id: IDS.first },
      { $push: { "revisions.$[r].scores": 7 } },
      { arrayFilters: [{ "r.lines": 40 }] },
    );
    expect((await article(IDS.first))?.revisions[1].scores).toEqual([9, 7]);
  });

  test("$setOnInsert writes an immutable field on upsert; upsertedId has the entity's _id type", async () => {
    const result = await Members.updateOne(
      { name: "Zed" },
      { $set: { role: "user" }, $setOnInsert: { email: "zed@example.test", tags: [] } },
      { upsert: true },
    );
    expect(result.upsertedCount).toBe(1);
    expect(result.upsertedId).toBeInstanceOf(ObjectId);
    const zed = await mongo.db.collection("q_members").findOne({ name: "Zed" });
    expect(zed?.email).toBe("zed@example.test");
  });

  test("updateMany, replaceOne (a full document without _id), deleteOne, deleteMany", async () => {
    const many = await Members.updateMany({ tags: { $size: 0 } }, { $set: { active: false } });
    expect(many.matchedCount).toBe(1);
    const replaced = await Articles.replaceOne(
      { _id: IDS.second },
      { title: "Replaced", author: IDS.ann, revisions: [], blocks: [], tags: [], publishedAt: null },
    );
    expect(replaced.modifiedCount).toBe(1);
    expect((await article(IDS.second))?.title).toBe("Replaced");
    expect((await Members.deleteOne({ name: "Eve" })).deletedCount).toBe(1);
    expect((await Members.deleteMany({ role: { $in: ["user", "admin"] } })).deletedCount).toBe(2);
  });

  test("findOneAndUpdate returns the document AFTER the update by default, before on request", async () => {
    const after = await Members.findOneAndUpdate({ _id: IDS.bob }, { $inc: { age: 1 } }).lean();
    expect(after?.age).toBe(18);
    const before = await Members.findOneAndUpdate(
      { _id: IDS.bob },
      { $inc: { age: 1 } },
      { returnDocument: "before" },
    ).lean();
    expect(before?.age).toBe(18);
    const upserted = await Members.findOneAndUpdate(
      { name: "New" },
      { $setOnInsert: { email: "new@example.test", tags: [] } },
      { upsert: true },
    ).lean();
    expect(upserted.name).toBe("New");
    const raw = await Members.findOneAndUpdate({ _id: IDS.bob }, { $set: { active: true } }).includeResultMetadata();
    expect(raw.ok).toBe(1);
    expect(raw.lastErrorObject?.updatedExisting).toBe(true);
    expect(raw.value?.active).toBe(true);
  });

  test("findOneAndReplace / findOneAndDelete; a projection applies to the returned document", async () => {
    const replaced = await Articles.findOneAndReplace(
      { _id: IDS.second },
      { title: "Swapped", author: IDS.bob, revisions: [], blocks: [], tags: ["x"], publishedAt: null },
    )
      .select({ title: 1 })
      .lean();
    expect(replaced).toEqual({ _id: IDS.second, title: "Swapped" });
    const deleted = await Members.findOneAndDelete({ _id: IDS.eve }).lean();
    expect(deleted?.name).toBe("Eve");
    expect(deleted && "passwordHash" in deleted).toBe(false);
  });

  test("a write is lazy and runs once: a second await of the same builder is an error", async () => {
    const write = Members.updateOne({ _id: IDS.bob }, { $inc: { age: 1 } });
    expect((await member(IDS.bob))?.age).toBe(17);
    await write;
    await expect(write.exec()).rejects.toThrow(/already executed; build a new one/);
    await expect(Promise.resolve(write)).rejects.toThrow(QueryError);
    expect((await member(IDS.bob))?.age).toBe(18);
    const modify = Members.findOneAndUpdate({ _id: IDS.bob }, { $inc: { age: 1 } }).lean();
    await modify;
    await expect(modify.exec()).rejects.toThrow(/already executed/);
    expect((await member(IDS.bob))?.age).toBe(19);
  });

  test("the server refuses a path through an array — which the types refuse too (write paths, W1 §4)", async () => {
    const error = await mongo.db
      .collection("q_articles")
      .updateOne({ _id: IDS.first }, { $set: { "revisions.note": "x" } })
      .catch((caught: unknown) => caught);
    expect((error as { code?: number }).code).toBe(28);
  });
});

describe("update pipelines (the pipeline builder's update mode)", () => {
  test("updateOne / updateMany / findOneAndUpdate take a pipeline callback; the server runs the stages", async () => {
    const { fn } = await import("../../../src/index.ts");
    await Members.updateOne({ _id: IDS.bob }, (p) => p.set((f) => ({ age: fn.add(f.age, 10) })));
    expect((await member(IDS.bob))?.age).toBe(27);
    const many = await Members.updateMany({ tags: { $size: 0 } }, (p) => p.set(() => ({ active: true })));
    expect(many.modifiedCount).toBe(1);
    const after = await Members.findOneAndUpdate({ _id: IDS.bob }, (p) =>
      p.set((f) => ({ age: fn.multiply(f.age, 2) })),
    ).lean();
    expect(after?.age).toBe(54);
  });
});

describe("a patch typed UpdateInput<T>", () => {
  test("$set takes it directly: the keys it holds are written, the absent ones are left alone", async () => {
    const patch: UpdateInput<Member> = { age: 40 };
    const before = await member(IDS.bob);
    await Members.updateOne({ _id: IDS.bob }, { $set: patch });
    const after = await member(IDS.bob);
    expect([after?.age, after?.name]).toEqual([40, before?.name]);
  });
});
