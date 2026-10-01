/*
 * The equality group of an ARRAY path — `$eq`, `$ne`, `$in`, `$nin` — takes an element or the whole array. The
 * element group and the whole-array group were intersected once, so `$in: ["a", "b"]` on a `string[]` field did
 * not compile (only `[]` fitted both). Checked for every operator of the group and for the array updates next to
 * them.
 */
import type { Filter } from "../../../src/index.ts";
import type { Member } from "../../fixtures/query/query-entities.ts";
import { Articles, Members } from "./setup.ts";

// ---- positive: element or whole array --------------------------------------------------------------
Members.find({ tags: { $in: ["a", "b"] } });
Members.find({ tags: { $nin: ["a"] } });
Members.find({ tags: { $in: [["a", "b"]] } }); // the whole array equals one of the lists
Members.find({ tags: { $in: ["a", ["b", "c"]] } });
Members.find({ tags: { $eq: ["a"] } });
Articles.find({ "revisions.scores": { $ne: 3 } });
Members.find({ tags: { $in: ["a"], $all: ["a"], $size: 2 } });
Members.find({ tags: { $elemMatch: { $in: ["a"] } } });
Articles.find({ "revisions.scores": { $in: [1, 2], $gt: 0 } }); // value operators apply to the elements
Articles.find({ $or: [{ tags: { $in: ["x"] } }, { title: { $in: ["t"] } }] });
const pretyped: Filter<Member> = { tags: { $in: ["a", "b"] } };
Members.find(pretyped);

// Updates of arrays next to them (checked for the same kind of intersection).
Members.updateOne({ tags: { $in: ["a"] } }, { $push: { tags: "a" } });
Members.updateOne({ name: "n" }, { $addToSet: { tags: { $each: ["a", "b"] } } });
Members.updateOne({ name: "n" }, { $pull: { tags: { $in: ["a"] } } });
Members.updateOne({ name: "n" }, { $pullAll: { tags: ["a"] } });

// ---- negative --------------------------------------------------------------------------------------
// @ts-expect-error — `$in` of numbers on a string[] field
Members.find({ tags: { $in: [1] } });
// @ts-expect-error — a list of numbers is not an element or a whole array of strings
Members.find({ tags: { $nin: [[1]] } });
// @ts-expect-error — `$gt` of a string on number elements
Articles.find({ "revisions.scores": { $gt: "1" } });
// @ts-expect-error — `$size` is a number
Members.find({ tags: { $size: "2" } });
