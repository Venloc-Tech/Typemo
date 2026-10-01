import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { Binary, ObjectId } from "mongodb";
import { BsonOptions, fn } from "../../../src/index.ts";
import { IDS, models, seed } from "../../fixtures/query/seed.ts";

/*
 * Every filter the types accept is accepted by the server and matches what it says.
 * The plans are executed by the test runner over the raw driver.
 */

const mongo = MongoLifecycle.useMongo("query_filters", BsonOptions.apply({}));
const { Members, Articles } = models(() => mongo.db);

beforeEach(async () => {
  await seed(mongo.db);
});

/**
 * The sorted names of the documents a query returns.
 * @param query The query to await.
 * @returns The names in alphabetical order.
 */
const names = async (query: PromiseLike<readonly { readonly name: string }[]>): Promise<string[]> =>
  (await query).map((doc) => doc.name).sort();

describe("filter operators on the server", () => {
  test("comparison, $in/$nin, $ne, $exists, null only on nullable paths", async () => {
    expect(await names(Members.find({ age: { $gte: 18, $lt: 65 } }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ role: { $in: ["admin", "editor"] } }).lean())).toEqual(["Ann", "Eve"]);
    expect(await names(Members.find({ role: { $nin: ["admin"] } }).lean())).toEqual(["Bob", "Eve"]);
    expect(await names(Members.find({ name: { $ne: "Ann" } }).lean())).toEqual(["Bob", "Eve"]);
    expect(await names(Members.find({ age: { $exists: false } }).lean())).toEqual(["Eve"]);
    /* `bestFriend` is nullable: `null` matches null AND missing (server semantics). */
    expect(await names(Members.find({ bestFriend: null }).lean())).toEqual(["Bob", "Eve"]);
    expect(await names(Members.find({ lastLogin: { $eq: null } }).lean())).toEqual(["Bob", "Eve"]);
    /* a nullable segment on the way: `profile.address.zip` is nullable. */
    expect(await names(Members.find({ "profile.address.zip": null }).lean())).toEqual(["Bob", "Eve"]);
  });

  test("$type with an L1 alias, a number, a list", async () => {
    expect(await names(Members.find({ visits: { $type: "long" } }).lean())).toEqual(["Ann", "Bob"]);
    expect(await names(Members.find({ balance: { $type: 19 } }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ lastLogin: { $type: ["date", "null"] } }).lean())).toEqual(["Ann", "Bob"]);
    expect(await names(Members.find({ age: { $type: "number" } }).lean())).toEqual(["Ann", "Bob"]);
  });

  test("strings: RegExp value, $regex with $options, $not with a RegExp", async () => {
    expect(await names(Members.find({ name: /^a/i }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ email: { $regex: "^B", $options: "i" } }).lean())).toEqual(["Bob"]);
    expect(await names(Members.find({ name: { $not: /^A/ } }).lean())).toEqual(["Bob", "Eve"]);
  });

  test("numbers: $mod, bitwise operators, bigint and Decimal128 comparisons", async () => {
    expect(await names(Members.find({ age: { $mod: [2, 0] } }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ age: { $bitsAllSet: [1, 5] } }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ age: { $bitsAnyClear: 1 } }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ visits: { $gt: 5n } }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ visits: { $mod: [2, 0] } }).lean())).toEqual(["Ann"]);
    const { Decimal128 } = await import("mongodb");
    expect(await names(Members.find({ balance: { $gte: Decimal128.fromString("10") } }).lean())).toEqual(["Ann"]);
  });

  test("arrays: element, whole array, $all, $size, $elemMatch of scalars and of subdocuments", async () => {
    expect(await names(Members.find({ tags: "vip" }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ tags: ["new"] }).lean())).toEqual(["Bob"]);
    expect(await names(Members.find({ tags: { $all: ["vip", "early"] } }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ tags: { $size: 0 } }).lean())).toEqual(["Eve"]);
    expect(await names(Members.find({ "profile.links": { $elemMatch: { clicks: { $gt: 2 } } } }).lean())).toEqual([
      "Ann",
    ]);
    const scored = await Articles.find({ "revisions.scores": { $elemMatch: { $gte: 8, $lt: 10 } } }).lean();
    expect(scored.map((article) => article.title)).toEqual(["Typed queries in MongoDB"]);
  });

  test("read paths through arrays and numeric element segments", async () => {
    expect(await names(Members.find({ "profile.links.url": { $regex: /github/ } }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ "tags.0": "new" }).lean())).toEqual(["Bob"]);
    const second = await Articles.find({ "revisions.1.lines": 40 }).lean();
    expect(second.map((article) => article.title)).toEqual(["Typed queries in MongoDB"]);
  });

  test("Map entries and fields inside Map values; union members in arrays", async () => {
    expect(await names(Members.find({ "counters.logins": { $gte: 2 } }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ "badges.gold.title": "Champion" }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ "badges.silver": { $exists: true } }).lean())).toEqual(["Ann"]);
    const images = await Articles.find({ "blocks.url": { $regex: "^https" }, "blocks.kind": "image" }).lean();
    expect(images.map((article) => article.title)).toEqual(["Typed queries in MongoDB"]);
  });

  test("logic: $and, $or, $nor (non-empty), $comment, $sampleRate", async () => {
    expect(await names(Members.find({ $or: [{ role: "admin" }, { age: { $lt: 18 } }] }).lean())).toEqual([
      "Ann",
      "Bob",
    ]);
    expect(await names(Members.find({ $and: [{ active: true }, { age: { $gt: 30 } }] }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ $nor: [{ role: "admin" }, { role: "user" }] }).lean())).toEqual(["Eve"]);
    expect(await names(Members.find({ name: "Ann", $comment: "typed filter" }).lean())).toEqual(["Ann"]);
    expect(await names(Members.find({ $sampleRate: 1 }).lean())).toEqual(["Ann", "Bob", "Eve"]);
  });

  test("$expr through the pipeline expressions (`fn`)", async () => {
    expect(await names(Members.find({ $expr: (f) => fn.gt(f.age, 20) }).lean())).toEqual(["Ann"]);
  });

  test("$jsonSchema", async () => {
    const matched = await Members.find({ $jsonSchema: { bsonType: "object", required: ["age"] } }).lean();
    expect(matched.map((member) => member.name).sort()).toEqual(["Ann", "Bob"]);
  });

  test("geo: $geoWithin with a GeoJSON polygon and a legacy $centerSphere, $near with a 2dsphere index", async () => {
    const polygon = {
      type: "Polygon",
      coordinates: [
        [
          [2, 48],
          [3, 48],
          [3, 49],
          [2, 49],
          [2, 48],
        ],
      ],
    } as const;
    expect(await names(Members.find({ "profile.address.geo": { $geoWithin: { $geometry: polygon } } }).lean())).toEqual(
      ["Ann"],
    );
    expect(
      await names(
        Members.find({ "profile.address.geo": { $geoWithin: { $centerSphere: [[2.35, 48.85], 0.001] } } }).lean(),
      ),
    ).toEqual(["Ann"]);
    await mongo.db.collection("q_members").createIndex({ "profile.address.geo": "2dsphere" });
    const near = await Members.find({
      "profile.address.geo": {
        $near: { $geometry: { type: "Point", coordinates: [2.3, 48.8] }, $maxDistance: 20_000 },
      },
    }).lean();
    expect(near.map((member) => member.name)).toEqual(["Ann"]);
  });

  test("$text with a text index", async () => {
    await mongo.db.collection("q_articles").createIndex({ title: "text" });
    const found = await Articles.find({ $text: { $search: "typed" } }).lean();
    expect(found.map((article) => article.title)).toEqual(["Typed queries in MongoDB"]);
  });

  test("binary bitmask operand", async () => {
    await mongo.db.collection("q_members").updateOne({ _id: IDS.eve }, { $set: { age: 7 } });
    expect(await names(Members.find({ age: { $bitsAllSet: new Binary(Buffer.from([7])) } }).lean())).toEqual(["Eve"]);
  });

  test("where(path) chain: conditions on one path merge into one operator object", async () => {
    const query = Members.find().where("age").gte(18).lt(65).where("role").in(["admin", "editor"]).lean();
    expect(query.build().filter).toEqual({ age: { $gte: 18, $lt: 65 }, role: { $in: ["admin", "editor"] } });
    expect(await names(query)).toEqual(["Ann"]);
    const chained = Members.find().where("tags").size(1).where("name").regex(/^b/i).where("age").exists().lean();
    expect(await names(chained)).toEqual(["Bob"]);
  });

  test("findById by the entity's _id type; unknown id → null", async () => {
    expect((await Members.findById(IDS.bob).lean())?.name).toBe("Bob");
    expect(await Members.findById(new ObjectId()).lean()).toBeNull();
  });
});
