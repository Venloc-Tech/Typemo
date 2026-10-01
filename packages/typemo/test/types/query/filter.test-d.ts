/*
 * `Filter<T>` — every operator by field type, no unknown keys, null only on nullable paths, non-empty logic, no
 * `undefined`. Negative cases state what must fail.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import { Binary, Decimal128, ObjectId, UUID } from "mongodb";
import { type Filter, fn } from "../../../src/index.ts";
import type { Member } from "../../fixtures/query/query-entities.ts";
import { Articles, Members, PostModel, UserModel } from "./setup.ts";

declare const maybe: string | undefined;
const id = new ObjectId();

// ---- positive ---------------------------------------------------------------------------------------
Members.find({ name: "Ann", age: { $gte: 18, $lt: 65 }, role: { $in: ["admin", "editor"] } });
Members.find({ age: { $exists: false }, bestFriend: null, lastLogin: { $eq: null }, "profile.address.zip": null });
Members.find({ name: /^a/i, email: { $regex: "^b", $options: "i" }, nickname: { $not: /x/ } });
Members.find({ age: { $mod: [2, 0], $bitsAllSet: [1, 5], $bitsAnyClear: 1 }, visits: { $gt: 5n, $mod: [2n, 0n] } });
Members.find({ balance: { $gte: Decimal128.fromString("1") }, _id: { $in: [id] } });
Members.find({
  visits: { $type: "long" },
  balance: { $type: 19 },
  lastLogin: { $type: ["date", "null"] },
  age: { $type: "number" },
});
Members.find({ tags: "vip" });
Members.find({ tags: ["a", "b"] });
Members.find({ tags: { $all: ["a"], $size: 2, $elemMatch: { $regex: "^v" } } });
Members.find({ "profile.links": { $elemMatch: { clicks: { $gt: 2 }, url: /x/ } } });
Members.find({ "profile.links.url": /github/, "tags.0": "vip", "profile.links.1.clicks": 3 });
Members.find({ "counters.logins": { $gte: 2 }, "badges.gold.title": "Champion", "badges.silver": { $exists: true } });
Members.find({ $or: [{ role: "admin" }, { age: { $lt: 18 } }], $nor: [{ name: "x" }], $and: [{ active: true }] });
Members.find({ $expr: (f) => fn.gt(f.age, 20), $comment: "c", $sampleRate: 0.5, $jsonSchema: { bsonType: "object" } });
Members.find({ $text: { $search: "x", $language: "en", $caseSensitive: false } });
Members.find({
  "profile.address.geo": { $near: { $geometry: { type: "Point", coordinates: [1, 2] }, $maxDistance: 10 } },
});
Members.find({
  "profile.address.geo": {
    $geoWithin: {
      $geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    },
  },
});
Members.find({
  "profile.address.geo": {
    $geoIntersects: {
      $geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  },
});
Members.find({ "profile.address.geo.coordinates": { $geoWithin: { $centerSphere: [[0, 0], 0.1] } } });
Articles.find({
  "blocks.url": "u",
  "blocks.kind": "image",
  "blocks.width": { $gt: 1 },
  "revisions.scores": { $elemMatch: { $gt: 1 } },
});
Members.find().where("age").gte(18).lt(65).where("tags").size(1).where("name").regex(/x/).where("age").mod(2, 0);
PostModel.find({
  "blocks.url": { $regex: "^https" },
  "blocks.size.width": { $gt: 100 },
  "meta.seo.og.card.type": "large",
});
UserModel.find({ "badges.gold.awardedBy": id, "mentions.x": id } as never);
// A strict (non-generic) filter annotation for a variable.
const reusable: Filter<Member> = { name: "a", age: { $gt: 1 } };
Members.find(reusable);
Members.countDocuments({ tags: { $size: 0 } });
Members.deleteMany({ age: { $lt: 0 } });
const everything = Members.find().lean();
expectTypeOf<Awaited<typeof everything>[number]["name"]>().toEqualTypeOf<string>();

// A dynamic filter (an index signature, built at run time) compiles; its paths are checked when the query runs.
declare const dynamic: Record<string, unknown>;
declare const indexed: { [key: string]: unknown };
declare const sparse: Partial<Record<string, string | number>>;
Members.find(dynamic);
Members.find(indexed);
Members.find(sparse);
Members.findOne(dynamic);
Members.countDocuments(dynamic);
Members.exists(dynamic);
Members.updateOne(dynamic, { $set: { name: "x" } });
Members.updateMany(indexed, { $set: { name: "x" } });
Members.deleteOne(dynamic);
Members.deleteMany(indexed);
Members.findOneAndUpdate(dynamic, { $set: { name: "x" } });
Members.findOneAndDelete(dynamic);
Members.find().where("name");
expectTypeOf(Members.find(dynamic).lean()).toMatchTypeOf<PromiseLike<unknown>>();

// ---- negative ---------------------------------------------------------------------------------------
// @ts-expect-error a literal path of an array index is still checked: a number where the elements are strings
Members.find({ "tags.0": 5 });
// @ts-expect-error a literal path inside an array of subdocuments is still checked
Members.find({ "profile.links.1.clicks": "x" });
// @ts-expect-error unknown field (no index signature; a generic filter reports it through "filter error")
Members.find({ nmae: "x" });
// @ts-expect-error unknown operator
Members.find({ age: { $gtx: 1 } });
// @ts-expect-error a value of the wrong type
Members.find({ age: "18" });
// @ts-expect-error $regex applies to strings only
Members.find({ age: { $regex: "1" } });
// @ts-expect-error null on a non-nullable, optional field (absent is $exists: false)
Members.find({ age: null });
// @ts-expect-error $gt on a boolean (no order)
Members.find({ active: { $gt: true } });
// @ts-expect-error an int64 field compares with bigint, not number
Members.find({ visits: { $gt: 5 } });
// @ts-expect-error $size applies to arrays only
Members.find({ name: { $size: 1 } });
// @ts-expect-error empty $or (the server refuses it)
Members.find({ $or: [] });
// @ts-expect-error `undefined` is never a value
Members.find({ name: maybe });
// @ts-expect-error junk path inside an opaque BSON value
Members.find({ "_id.id": 1 });
// @ts-expect-error junk path inside a Decimal128
Members.find({ "balance.bytes": 1 });
// @ts-expect-error a field inside a Map value that does not exist
Members.find({ "badges.gold.titel": "x" });
// @ts-expect-error a field inside a Map value with the wrong type
Members.find({ "badges.gold.level": "3" });
// @ts-expect-error a path inside a scalar Map value
Members.find({ "counters.logins.x": 1 });
// @ts-expect-error a field of no member of the embedded union
Articles.find({ "blocks.nope": 1 });
// @ts-expect-error $where is legacy
Members.find({ $where: "this.age > 1" });
// @ts-expect-error $expr is typed: a raw object is refused
Members.find({ $expr: { $gt: ["$age", 1] } });
// @ts-expect-error $near needs a GeoJSON point or a legacy pair, not an object of anything
Members.find({ "profile.address.geo": { $near: { lat: 1 } } });
// @ts-expect-error geo operators apply to GeoJSON fields and coordinate arrays only
Members.find({ name: { $near: [1, 2] } });
// @ts-expect-error where(path) of an unknown path
Members.find().where("nmae");
// @ts-expect-error gte on a boolean field (no order)
Members.find().where("active").gte(true);
// @ts-expect-error regex on a number field
Members.find().where("age").regex(/x/);
// @ts-expect-error a bitmask is a number, a list of positions or a Binary, not a string
Members.find({ age: { $bitsAllSet: "1" } });
export const unused = [new Binary(), new UUID()];

// ---- keys deeper than the enumerated ceiling (5) are walked, not refused -------------
UserModel.find({ "profile.settings.notifications.push.quietHours.from": { $gte: 22 } });
// @ts-expect-error a wrong value at depth 6
UserModel.find({ "profile.settings.notifications.push.quietHours.from": "late" });
// @ts-expect-error an unknown field at depth 6
UserModel.find({ "profile.settings.notifications.push.quietHours.nope": 1 });
