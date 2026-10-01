/*
 * Populate VIRTUALS on the real server (`@Virtual({ ref, localField, foreignField, … })`) — many, justOne
 * (the virtual's and the call's), count (an aggregation, not the documents), the virtual's own `match`
 * combined with the call's by `$and`, per-document limits through ONE `$lookup` aggregation, UUID local
 * values, nothing found, and the query count of each form.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { QueryError, StrictModeError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("pop_virtuals");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

/**
 * The names of the commands recorded so far.
 * @returns The command names in order.
 */
const commands = () => t.commands.all().map((command) => command.commandName);
/**
 * The titles of some posts.
 * @param posts The posts, or undefined.
 * @returns The titles, or undefined.
 */
const titles = (posts: readonly { readonly title: string }[] | undefined) => posts?.map((post) => post.title);

describe("a virtual: many", () => {
  test("the documents whose foreignField is the local value; [] when none; one query", async () => {
    const people = await m.People.find({ _id: { $in: [P.ann, P.bob, P.cid] } })
      .sort({ name: 1 })
      .populate({ path: "posts", options: { sort: { views: 1 } } })
      .lean();
    expect(people.map((person) => titles(person.posts))).toEqual([["one", "three", "two"], ["four"], []]);
    expect(commands()).toEqual(["find", "find"]);
  });

  test("hydrated: documents of the Post model, the virtual is not stored data", async () => {
    const ann = await m.People.findById(P.ann).populate("posts").orFail();
    expect(ann.posts?.length).toBe(3);
    expect(ann.$isModified()).toBe(false);
    expect(Object.keys(ann.$toObject())).toContain("posts");
    ann.age = 31;
    await ann.$save();
    const stored = await t.mongo.db.collection("pp_people").findOne({ _id: P.ann });
    expect(stored && "posts" in stored).toBe(false);
  });

  test("the virtual's match AND the call's match (combined, never replaced)", async () => {
    const ann = await m.People.findById(P.ann)
      .populate({ path: "publishedPosts", match: { views: { $gte: 15 } } })
      .orFail()
      .lean();
    expect(titles(ann.publishedPosts)).toEqual(["three"]);
    const filter = t.commands.byName("find")[1]?.command.filter as { $and: unknown[] };
    expect(filter.$and.length).toBe(2);
  });

  test("UUID local values", async () => {
    const device = await m.Devices.findById(P.device)
      .populate({ path: "readings", options: { sort: { value: 1 } } })
      .orFail()
      .lean();
    expect(device.readings?.map((reading) => reading.value)).toEqual([1, 3]);
  });

  test("a hydrated document that did not load the local field refuses (never a silent [])", async () => {
    await expect(m.Posts.findById(P.p1).select({ title: 1, _id: 0 }).populate("comments").exec()).rejects.toThrow(
      QueryError,
    );
  });
});

describe("a virtual: justOne", () => {
  test("the virtual's justOne with its default sort: the top document or null", async () => {
    const people = await m.People.find({ _id: { $in: [P.ann, P.cid] } })
      .sort({ name: 1 })
      .populate("topPost")
      .lean();
    expect(people.map((person) => person.topPost?.title ?? null)).toEqual(["two", null]);
    /* several owners and one per owner: one aggregation ($lookup + $limit) */
    expect(commands()).toEqual(["find", "aggregate"]);
    const pipeline = t.commands.byName("aggregate")[0]?.command.pipeline as Record<string, unknown>[];
    const lookup = pipeline.find((stage) => "$lookup" in stage)?.$lookup as { pipeline: Record<string, unknown>[] };
    expect(lookup.pipeline.some((stage) => (stage as { $limit?: number }).$limit === 1)).toBe(true);
  });

  test("justOne from the call overrides the virtual's", async () => {
    const ann = await m.People.findById(P.ann)
      .populate({ path: "posts", justOne: true, options: { sort: { views: -1 } } })
      .orFail()
      .lean();
    expect(ann.posts?.title).toBe("two");
    /* one owner: a find with the limit */
    expect(t.commands.byName("find")[1]?.command.limit).toBe(1);
    const top = await m.People.findById(P.ann).populate({ path: "topPost", justOne: false }).orFail().lean();
    expect(top.topPost?.length).toBe(3);
  });
});

describe("a virtual: per-document limit", () => {
  test("limit per owner through one $lookup aggregation, exactly (no Mongoose limit × N)", async () => {
    const people = await m.People.find({ _id: { $in: [P.ann, P.bob] } })
      .sort({ name: 1 })
      .populate({ path: "posts", options: { sort: { views: -1 }, limit: 2, skip: 0 } })
      .lean();
    expect(people.map((person) => titles(person.posts))).toEqual([["two", "three"], ["four"]]);
    expect(commands()).toEqual(["find", "aggregate"]);
    const people2 = await m.People.find({ _id: { $in: [P.ann, P.bob] } })
      .sort({ name: 1 })
      .populate({ path: "posts", perDocumentLimit: 1, options: { sort: { views: 1 }, skip: 1 } })
      .lean();
    expect(people2.map((person) => titles(person.posts))).toEqual([["three"], []]);
  });

  test("the local values given to $lookup come from memory, not from a re-read of the owners", async () => {
    const ann = await m.People.findById(P.ann).orFail();
    const bob = await m.People.findById(P.bob).orFail();
    await m.People.deleteOne({ _id: P.bob });
    /* bob no longer exists in the database: his posts are still found by his (in-memory) local value */
    await ann.$populate({ path: "posts", perDocumentLimit: 1 });
    const populated = await bob.$populate({ path: "posts", perDocumentLimit: 1 });
    expect(populated.posts.map((post) => post.title)).toEqual(["four"]);
  });
});

describe("a virtual: count", () => {
  test("the number of documents per owner, by an aggregation ($group), 0 when none", async () => {
    const people = await m.People.find({ _id: { $in: [P.ann, P.bob, P.cid] } })
      .sort({ name: 1 })
      .populate("postCount")
      .lean();
    expect(people.map((person) => person.postCount)).toEqual([3, 1, 0]);
    expect(commands()).toEqual(["find", "aggregate"]);
    const pipeline = t.commands.byName("aggregate")[0]?.command.pipeline as Record<string, unknown>[];
    expect(pipeline.some((stage) => "$group" in stage)).toBe(true);
  });

  test("count with a match", async () => {
    const ann = await m.People.findById(P.ann)
      .populate({ path: "postCount", match: { published: true } })
      .orFail();
    expect(ann.postCount).toBe(2);
  });

  test("count takes no select / limit / transform (a number)", async () => {
    await expect(
      m.People.findById(P.ann)
        .populate({ path: "postCount", select: { title: 1 } } as never)
        .exec(),
    ).rejects.toThrow(/count virtual takes no select/);
  });
});

describe("sanitize (CVE-2025-23061): every populate filter", () => {
  test("$where in match, also nested in $and, is refused before any query", async () => {
    await expect(
      m.People.findById(P.ann)
        .populate({ path: "posts", match: { $and: [{ $where: "sleep(1000)" }] } as never })
        .exec(),
    ).rejects.toThrow(StrictModeError);
    expect(commands()).toEqual([]);
  });

  test("a match function's filter is sanitized too (its own query)", async () => {
    await expect(
      m.People.findById(P.ann)
        .populate({ path: "posts", match: () => ({ $where: "true" }) as never })
        .exec(),
    ).rejects.toThrow(StrictModeError);
  });

  test("an operator object as a value is refused (query selector injection)", async () => {
    await expect(
      m.People.findById(P.ann)
        .populate({ path: "posts", match: { title: { $ne: null, x: 1 } } as never })
        .exec(),
    ).rejects.toThrow(StrictModeError);
  });
});
