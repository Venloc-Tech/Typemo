/*
 * `isPopulated(doc, path)` on the real server (R61, finding 80): one function takes a post in any population state
 * (`AnyPopulationDoc<Post>`) and learns at run time — from the same population records `$populated()` reads —
 * whether a reference, an array of references, a Map of references or a populate virtual holds its populated value.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { type AnyPopulationDoc, isPopulated } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import type { Person, Post } from "../../fixtures/populate/populate-entities.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("pop_is_populated");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

/**
 * The author's name when the author is populated, `undefined` when the post holds the id.
 * @param post The post in any population state.
 * @returns The author's name, or `undefined`.
 */
const authorName = (post: AnyPopulationDoc<Post>): string | undefined =>
  isPopulated(post, "author") ? post.author?.name : undefined;

describe("isPopulated", () => {
  test("a single reference: false for the id, true once populated", async () => {
    const plain = await m.Posts.findById(P.p1).orFail();
    expect(authorName(plain)).toBeUndefined();
    const populated = await m.Posts.findById(P.p1).populate("author").orFail();
    expect(authorName(populated)).toBe("ann");
    expect(authorName(await plain.$populate("author"))).toBe("ann"); /* $populate records the same way */
  });

  test("a reference whose document is gone: populated, null", async () => {
    const dan: AnyPopulationDoc<Person> = await m.People.findById(P.dan).populate("company").orFail();
    expect(isPopulated(dan, "company")).toBe(true);
    if (isPopulated(dan, "company")) expect(dan.company).toBeNull();
  });

  test("an absent reference: nothing populated", async () => {
    const cid: AnyPopulationDoc<Person> = await m.People.findById(P.cid).populate("company").orFail();
    expect(isPopulated(cid, "company")).toBe(false);
  });

  test("an array, a Map and virtuals", async () => {
    const plain: AnyPopulationDoc<Person> = await m.People.findById(P.ann).orFail();
    expect(isPopulated(plain, "friends")).toBe(false);
    expect(isPopulated(plain, "tagsByTopic")).toBe(false);
    expect(isPopulated(plain, "posts")).toBe(false);
    const ann: AnyPopulationDoc<Person> = await m.People.findById(P.ann)
      .populate(["friends", "tagsByTopic.$*", "posts", "postCount"])
      .orFail();
    if (!isPopulated(ann, "friends")) throw new Error("friends are populated");
    expect(ann.friends.map((friend) => friend?.name)).toEqual(["bob", "cid"]); /* the gone one dropped */
    if (!isPopulated(ann, "tagsByTopic")) throw new Error("tagsByTopic is populated");
    expect(ann.tagsByTopic.get("color")?.label).toBe("red");
    if (!isPopulated(ann, "posts")) throw new Error("posts are populated");
    expect(ann.posts.map((post) => post.title).sort()).toEqual(["one", "three", "two"]);
    if (!isPopulated(ann, "postCount")) throw new Error("postCount is populated");
    expect(ann.postCount).toBe(3);
    expect(isPopulated(ann, "company")).toBe(false); /* not asked for */
  });

  test("nested: the populated document is in any population state too", async () => {
    const post: AnyPopulationDoc<Post> = await m.Posts.findById(P.p4)
      .populate({ path: "author", populate: "company" })
      .orFail();
    if (!isPopulated(post, "author") || post.author === null) throw new Error("the author is populated");
    expect(isPopulated(post.author, "company")).toBe(true);
    expect(isPopulated(post.author, "friends")).toBe(false);
  });

  test("depopulated or replaced: no longer populated", async () => {
    const post = await m.Posts.findById(P.p1).populate("author").orFail();
    const back: AnyPopulationDoc<Post> = post.$depopulate("author");
    expect(isPopulated(back, "author")).toBe(false);
    const again = await m.Posts.findById(P.p1).populate("author").orFail();
    again.$set("author", P.bob);
    const replaced: AnyPopulationDoc<Post> = again;
    expect(isPopulated(replaced, "author")).toBe(false);
  });
});
