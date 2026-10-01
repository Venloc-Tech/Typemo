/*
 * `Update<T>` — write paths (never through an array without a token), positional tokens at any depth with typed
 * arrayFilters, immutable only in $setOnInsert, null only for nullable, $inc on bigint/Decimal128, typed $rename
 * and $push.$sort, Map-value fields, the empty update.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import { Decimal128, ObjectId } from "mongodb";
import { fn, type UpdateInput, type UpdateResult } from "../../../src/index.ts";
import type { Member } from "../../fixtures/query/query-entities.ts";
import { Articles, Members, PostModel } from "./setup.ts";

declare const maybe: string | undefined;
const id = new ObjectId();

// ---- positive ---------------------------------------------------------------------------------------
Members.updateOne(
  { _id: id },
  { $set: { name: "x", "profile.bio": "b", "profile.address.zip": null, bestFriend: null } },
);
Members.updateOne(
  { _id: id },
  { $set: { "profile.links.$.clicks": 1, "profile.links.0.url": "u", "profile.links.$[l].url": "v" } },
);
Articles.updateOne(
  { _id: id },
  { $set: { "revisions.$[r].note": "n" } },
  { arrayFilters: [{ "r.lines": { $gt: 1 } }] },
);
Articles.updateOne(
  { _id: id },
  { $set: { "revisions.$[r].scores.$[s]": 0 } },
  { arrayFilters: [{ "r.lines": { $lt: 20 } }, { s: { $gte: 5 } }] },
);
Articles.updateOne({ _id: id }, { $inc: { "revisions.$[].lines": 1, views: 1 } });
Members.updateOne(
  { _id: id },
  { $inc: { age: 1, visits: 5n, balance: Decimal128.fromString("1") }, $mul: { "counters.logins": 2 } },
);
Members.updateOne({ _id: id }, { $min: { age: 1 }, $max: { visits: 100n, lastLogin: new Date() } });
Members.updateOne({ _id: id }, { $currentDate: { lastLogin: true } });
Members.updateOne({ _id: id }, { $unset: { age: 1, "profile.bio": "" }, $rename: { nickname: "handle" } });
Members.updateOne({ _id: id }, { $bit: { age: { and: 1 } } });
Members.updateOne({ _id: id }, { $push: { tags: { $each: ["a"], $position: 0, $slice: 5, $sort: 1 } } });
Members.updateOne({ _id: id }, { $push: { "profile.links": { $each: [{ url: "u" }], $sort: { clicks: -1 } } } });
Members.updateOne(
  { _id: id },
  { $addToSet: { tags: { $each: ["b"] } }, $pullAll: { favorites: [id] }, $pop: { "profile.links": -1 } },
);
Members.updateOne({ _id: id }, { $pull: { "profile.links": { clicks: { $lt: 1 } } } });
Members.updateOne({ _id: id }, { $pull: { tags: { $in: ["a"] } } });
Members.updateOne({ _id: id }, { $setOnInsert: { email: "e@x.test" } }, { upsert: true });
Members.updateOne(
  { _id: id },
  { $inc: { "counters.logins": 1 }, $set: { "badges.gold.title": "t", "badges.new": { title: "n" } } },
);
Articles.updateOne({ _id: id }, { $set: { "blocks.$[b].width": 10 } }, { arrayFilters: [{ "b.kind": "image" }] });
PostModel.updateOne(
  { _id: id },
  { $set: { "revisions.$[r].diff.files.$[f].lines": 3 } },
  { arrayFilters: [{ "r.note": "x" }, { "f.path": "a" }] },
);
const updated = Members.updateOne({ _id: id }, { $set: { name: "x" } });
expectTypeOf<Awaited<typeof updated>>().toEqualTypeOf<UpdateResult<ObjectId>>();
Articles.replaceOne({ _id: id }, { title: "t", author: id, revisions: [], blocks: [], tags: [], publishedAt: null });

// ---- negative ---------------------------------------------------------------------------------------
// @ts-expect-error a path THROUGH an array without a positional token (server code 28)
Articles.updateOne({ _id: id }, { $set: { "revisions.note": "x" } });
// @ts-expect-error immutable field outside $setOnInsert
Members.updateOne({ _id: id }, { $set: { email: "x" } });
// @ts-expect-error the root _id is never written (server code 66)
Members.updateOne({ _id: id }, { $set: { _id: id } });
// @ts-expect-error null on a non-nullable field
Members.updateOne({ _id: id }, { $set: { name: null } });
// @ts-expect-error undefined in $set (the driver would write null)
Members.updateOne({ _id: id }, { $set: { name: maybe } });
// @ts-expect-error $inc on a string
Members.updateOne({ _id: id }, { $inc: { name: 1 } });
// @ts-expect-error $inc on an int64 takes a bigint
Members.updateOne({ _id: id }, { $inc: { visits: 1 } });
// @ts-expect-error $unset of a required field
Members.updateOne({ _id: id }, { $unset: { name: 1 } });
// @ts-expect-error $rename to a path of another type
Members.updateOne({ _id: id }, { $rename: { nickname: "age" } });
// @ts-expect-error $push on a non-array
Members.updateOne({ _id: id }, { $push: { name: "x" } });
// @ts-expect-error $push.$sort by a field the element does not have
Members.updateOne({ _id: id }, { $push: { "profile.links": { $each: [], $sort: { nope: 1 } } } });
// @ts-expect-error $push of an element of the wrong type
Members.updateOne({ _id: id }, { $push: { tags: 1 } });
// @ts-expect-error an empty update
Members.updateOne({ _id: id }, {});
// @ts-expect-error one path under two operators (server code 40)
Members.updateOne({ _id: id }, { $set: { age: 1 }, $inc: { age: 1 } });
// @ts-expect-error an unknown path in $set
Members.updateOne({ _id: id }, { $set: { nmae: "x" } });
// @ts-expect-error a field inside a Map value with the wrong type
Members.updateOne({ _id: id }, { $set: { "badges.gold.title": 1 } });
// @ts-expect-error $inc on a string inside a Map value
Members.updateOne({ _id: id }, { $inc: { "badges.gold.title": 1 } });
// @ts-expect-error arrayFilters of an identifier the update does not use, or of a wrong field
Articles.updateOne({ _id: id }, { $set: { "revisions.$[r].note": "n" } }, { arrayFilters: [{ "r.nope": 1 }] });
// @ts-expect-error arrayFilters when the update has no identifier
Articles.updateOne({ _id: id }, { $set: { title: "t" } }, { arrayFilters: [{ "r.lines": 1 }] });
// @ts-expect-error an update pipeline is built with the pipeline builder (5B), not written as an array
Members.updateOne({ _id: id }, [{ $set: { name: "x" } }]);
// @ts-expect-error a replacement has no operators
Articles.replaceOne({ _id: id }, { $set: { title: "t" } });
// @ts-expect-error a replacement needs the required fields
Articles.replaceOne({ _id: id }, { title: "t" });
Articles.replaceOne(
  { _id: id },
  // @ts-expect-error a replacement never carries _id
  { _id: id, title: "t", author: id, revisions: [], blocks: [], tags: [], publishedAt: null },
);

// ---- update pipelines (5B builder, update mode) -----------------------------------------------------
Members.updateOne({ _id: id }, (p) => p.set((f) => ({ age: fn.add(f.age, 1) })));
Members.findOneAndUpdate({ _id: id }, (p) => p.unset("nickname"), { upsert: true });
// @ts-expect-error arrayFilters are not allowed with a pipeline
Members.updateOne({ _id: id }, (p) => p.unset("nickname"), { arrayFilters: [{ "x.a": 1 }] });

// ---- a patch typed UpdateInput<T> (every key optional) ------------------------------------------------
declare const patch: UpdateInput<Member>;
// An optional key may be absent: absent is not an `undefined` value.
Members.updateOne({ _id: id }, { $set: patch });
Members.updateMany({ age: { $gte: 1 } }, { $set: patch });
// @ts-expect-error the patch may hold "visits" too: one path under two operators (server code 40)
Members.updateMany({ age: { $gte: 1 } }, { $set: patch, $inc: { visits: 1n } });
Members.findOneAndUpdate({ _id: id }, { $set: patch });
Members.updateOne({ _id: id }, { $setOnInsert: patch }, { upsert: true });
declare const maybePatch: { name: string | undefined };
// @ts-expect-error a key whose value may be undefined (the driver would write null); an absent optional key is fine
Members.updateOne({ _id: id }, { $set: maybePatch });
