/*
 * On the real server: `populate({ path, required: true })` — a reference that finds nothing is an error
 * (the type has no `| null`), a stored `null` is not a reference; `clone: true` gives each owner its own
 * copy (off by default: one shared object per found document).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { DocumentNotFoundError, QueryError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("pop_required_clone");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

describe("required populate", () => {
  test("a single reference that finds nothing → DocumentNotFoundError naming the path and the id", async () => {
    const run = m.People.findById(P.dan).populate({ path: "company", required: true }).lean().exec();
    await expect(run).rejects.toBeInstanceOf(DocumentNotFoundError);
    await expect(m.People.findById(P.dan).populate({ path: "company", required: true }).exec()).rejects.toThrow(
      `populate "company": no document for the reference ${P.goneCompany.toHexString()} (required: true)`,
    );
  });

  test("found → the document, as without required", async () => {
    const doc = await m.People.findById(P.ann).populate({ path: "company", required: true }).orFail().lean();
    expect(doc.company?.name).toBe("acme");
  });

  test("a stored null is not a reference: it stays null", async () => {
    const doc = await m.People.findById(P.ann).populate({ path: "mentor", required: true }).orFail().lean();
    expect(doc.mentor).toBeNull();
  });

  test("an array with one dangling id → error (the other ids are not silently dropped)", async () => {
    await expect(
      m.People.findById(P.ann).populate({ path: "friends", required: true }).lean().exec(),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    const cid = await m.People.findById(P.cid).populate({ path: "friends", required: true }).orFail().lean();
    expect(cid.friends.map((friend) => friend.name)).toEqual(["ann"]);
  });

  test("with match: a document that does not match is 'not found' → error", async () => {
    await expect(
      m.People.findById(P.ann)
        .populate({ path: "company", match: { size: { $gt: 100 } }, required: true })
        .lean()
        .exec(),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  test("justOne virtual with no document → error; with one → the document", async () => {
    await expect(
      m.People.findById(P.dan).populate({ path: "topPost", required: true }).lean().exec(),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    const ann = await m.People.findById(P.ann).populate({ path: "topPost", required: true }).orFail().lean();
    expect(ann.topPost.title).toBe("two");
  });

  test("a count virtual takes no required (it gives a number)", async () => {
    await expect(
      m.People.findById(P.ann)
        .populate({ path: "postCount", required: true } as never)
        .exec(),
    ).rejects.toBeInstanceOf(QueryError);
  });

  test("required must be a boolean", async () => {
    expect(() => m.People.findById(P.ann).populate({ path: "company", required: "yes" } as never)).toThrow(QueryError);
  });
});

describe("clone", () => {
  test("off by default: the author of three posts is ONE object (a change through one post is seen by all)", async () => {
    const posts = await m.Posts.find({ author: P.ann }).sort({ title: 1 }).populate("author");
    expect(posts.length).toBe(3);
    const [a, b] = posts;
    expect(a?.author).toBe(b?.author);
  });

  test("clone: true → every post has its own copy, equal data, independent changes", async () => {
    const posts = await m.Posts.find({ author: P.ann }).sort({ title: 1 }).populate({ path: "author", clone: true });
    const [a, b, c] = posts;
    expect(a?.author).not.toBe(b?.author);
    expect(b?.author).not.toBe(c?.author);
    expect(a?.author?.$toObject()).toEqual(b?.author?.$toObject());
    a?.author?.$set("name", "changed");
    expect(b?.author?.name).toBe("ann");
    expect(a?.author?.$isModified("name")).toBe(true);
    expect(b?.author?.$isModified()).toBe(false);
  });

  test("clone with lean: deep copies (dates and nested values not shared)", async () => {
    const posts = await m.Posts.find({ author: P.ann }).populate({ path: "author", clone: true }).lean();
    const [a, b] = posts;
    expect(a?.author).not.toBe(b?.author);
    expect(a?.author).toEqual(b?.author as never);
    expect(a?.author?.friends).not.toBe(b?.author?.friends);
  });

  test("clone with nested populate: the nested documents are copies too", async () => {
    const posts = await m.Posts.find({ author: P.ann }).populate({
      path: "author",
      clone: true,
      populate: "company",
    });
    const [a, b] = posts;
    expect(a?.author?.company?.name).toBe("acme");
    /* The nested path has no clone of its own: its document is shared (clone applies per path). */
    expect(a?.author?.company).toBe(b?.author?.company);
    const cloned = await m.Posts.find({ author: P.ann }).populate({
      path: "author",
      clone: true,
      populate: { path: "company", clone: true },
    });
    expect(cloned[0]?.author?.company).not.toBe(cloned[1]?.author?.company);
    expect(cloned[0]?.author?.company?.name).toBe("acme");
  });

  test("clone keeps the order of a sorted array populate", async () => {
    const doc = await m.People.findById(P.ann)
      .populate({ path: "friends", clone: true, options: { sort: { name: -1 } } })
      .orFail()
      .lean();
    expect(doc.friends.map((friend) => friend.name)).toEqual(["cid", "bob"]);
  });
});
