/*
 * Populate of REFERENCES on the real server — a single `Ref<M>`, an array `Ref<M>[]`, nullable and self
 * references — with every option: select (and a select without `_id`), match (`null`), justOne both ways,
 * retainNullValues, sort, per-document limit/skip (no "limit × N"), transform; lean and hydrated alike;
 * queries counted.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { ObjectId } from "mongodb";
import { Documents } from "../../../src/document/documents.ts";
import { QueryError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { Person } from "../../fixtures/populate/populate-entities.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("pop_refs");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

/**
 * The recorded `find` commands.
 * @returns The recorded commands.
 */
const finds = () => t.commands.byName("find");
/**
 * The ids of some documents as hex strings.
 * @param docs The documents.
 * @returns The hex ids in order.
 */
const ids = (docs: readonly { readonly _id: ObjectId }[]) => docs.map((doc) => doc._id.toHexString());

describe("a single reference", () => {
  test("found → the document; one query per path; lean and hydrated have the same data", async () => {
    const lean = await m.People.findById(P.ann).populate("company").orFail().lean();
    expect(lean.company).toEqual({ _id: P.acme, name: "acme", size: 10 }); /* Hidden secret left out */
    expect(finds().length).toBe(2);
    const doc = await m.People.findById(P.ann).populate("company").orFail();
    expect(Documents.is(doc.company)).toBe(true);
    expect(doc.company?.name).toBe("acme");
    expect(doc.$toObject().company).toEqual(lean.company);
  });

  test("not found → null, the stored id kept behind it", async () => {
    const doc = await m.People.findById(P.dan).populate("company").orFail();
    expect(doc.company).toBeNull();
    expect(doc.$populated("company")).toEqual(P.goneCompany);
    expect(doc.$isModified()).toBe(false);
  });

  test("a null or absent reference is left as it is, no query for it", async () => {
    const [ann, cid] = await m.People.find({ _id: { $in: [P.ann, P.cid] } })
      .sort({ name: 1 })
      .populate("mentor")
      .lean();
    expect(ann?.mentor).toBeNull();
    expect(cid && "mentor" in cid).toBe(false);
    expect(finds().length).toBe(1); /* nothing to look up */
  });

  test("match: a document that does not match is null (typed | null)", async () => {
    const docs = await m.People.find({ _id: { $in: [P.ann, P.bob] } })
      .sort({ name: 1 })
      .populate({ path: "company", match: { size: { $gt: 15 } } })
      .lean();
    expect(docs.map((doc) => doc.company?.name ?? null)).toEqual([null, "globex"]);
  });

  test("select: the fields asked for; _id left out is removed after matching", async () => {
    const doc = await m.People.findById(P.ann)
      .populate({ path: "company", select: { name: 1, _id: 0 } })
      .orFail()
      .lean();
    expect(doc.company).toEqual({ name: "acme" });
    const sent = finds()[1]?.command.projection as Record<string, unknown>;
    expect(sent._id).not.toBe(0); /* the id is needed to match: added, then removed */
  });

  test("select +hidden field", async () => {
    const doc = await m.People.findById(P.ann)
      .populate({ path: "company", select: { "+secret": true } })
      .orFail()
      .lean();
    expect(doc.company?.secret).toBe("s1");
  });

  test("justOne: false makes it a list of one (or none)", async () => {
    const doc = await m.People.findById(P.ann).populate({ path: "company", justOne: false }).orFail().lean();
    expect(doc.company?.map((company) => company.name)).toEqual(["acme"]);
    const dan = await m.People.findById(P.dan).populate({ path: "company", justOne: false }).orFail().lean();
    expect(dan.company).toEqual([]);
  });

  test("transform: called with the document or null and the id; the field holds the result", async () => {
    const calls: unknown[] = [];
    const [ann, dan] = await m.People.find({ _id: { $in: [P.ann, P.dan] } })
      .sort({ name: 1 })
      .populate({
        path: "company",
        transform: (company, id) => {
          calls.push(id);
          return company === null ? `missing ${id.toHexString()}` : company.name.toUpperCase();
        },
      })
      .lean();
    expect(ann?.company).toBe("ACME");
    expect(dan?.company).toBe(`missing ${P.goneCompany.toHexString()}`);
    expect(calls.length).toBe(2);
  });
});

describe("an array of references", () => {
  test("order of the ids; ids without a document are left out of the VIEW, kept in the data", async () => {
    const doc = await m.People.findById(P.ann).populate("friends").orFail();
    expect(doc.friends.map((friend) => friend.name)).toEqual(["bob", "cid"]);
    expect(doc.$populated("friends")).toEqual([P.bob, P.gone, P.cid]);
    doc.name = "ann2";
    await doc.$save();
    const stored = await t.mongo.db.collection("pp_people").findOne({ _id: P.ann });
    expect(stored?.friends).toEqual([P.bob, P.gone, P.cid]); /* Mongoose lost P.gone here */
  });

  test("retainNullValues: null at the position of an id without a document", async () => {
    const doc = await m.People.findById(P.ann).populate({ path: "friends", retainNullValues: true }).orFail().lean();
    expect(doc.friends.map((friend) => friend?.name ?? null)).toEqual(["bob", null, "cid"]);
  });

  test("sort: the order of the query; limit and skip PER DOCUMENT (no Mongoose limit × N)", async () => {
    await m.People.updateOne({ _id: P.bob }, { $set: { friends: [P.ann, P.cid, P.dan] } });
    t.commands.clear();
    const docs = await m.People.find({ _id: { $in: [P.ann, P.bob] } })
      .sort({ name: 1 })
      .populate({ path: "friends", options: { sort: { name: -1 }, limit: 2 } })
      .lean();
    expect(docs.map((doc) => doc.friends.map((friend) => friend.name))).toEqual([
      ["cid", "bob"],
      ["dan", "cid"],
    ]);
    expect(finds().length).toBe(2); /* one populate query for both documents */
    expect(finds()[1]?.command.limit).toBeUndefined(); /* the limit is per document, applied exactly */
    const skipped = await m.People.findById(P.bob)
      .populate({ path: "friends", options: { skip: 1 }, perDocumentLimit: 1 })
      .orFail()
      .lean();
    expect(skipped.friends.map((friend) => friend.name)).toEqual(["cid"]);
  });

  test("justOne: true on an array: the first document found", async () => {
    const doc = await m.People.findById(P.ann).populate({ path: "friends", justOne: true }).orFail().lean();
    expect(doc.friends?.name).toBe("bob");
  });

  test("transform on an array keeps every position (null for a missing document)", async () => {
    const doc = await m.People.findById(P.ann)
      .populate({ path: "friends", transform: (friend) => friend?.name ?? "?" })
      .orFail()
      .lean();
    expect(doc.friends).toEqual(["bob", "?", "cid"]);
  });

  test("match on _id is combined with the ids, never replaces them", async () => {
    const doc = await m.People.findById(P.ann)
      .populate({ path: "friends", match: { _id: { $ne: P.bob } } })
      .orFail()
      .lean();
    expect(doc.friends.map((friend) => friend.name)).toEqual(["cid"]);
    const filter = finds()[1]?.command.filter as { $and: unknown[] };
    expect(filter.$and.length).toBe(2);
  });

  test("the hydrated view is read-only: changing references goes through $depopulate or $set", async () => {
    const doc = await m.People.findById(P.ann).populate("friends").orFail();
    /* cast: bypasses the type to test the runtime guard — a populated array is read-only (the type has no push) */
    expect(() => (doc.friends as unknown as { push(x: unknown): void }).push(P.dan)).toThrow(QueryError);
    doc.$set("friends", [P.dan]);
    expect(doc.$populated("friends")).toBeUndefined();
    await doc.$save();
    expect((await t.mongo.db.collection("pp_people").findOne({ _id: P.ann }))?.friends).toEqual([P.dan]);
  });

  test("retainNullValues with sort is refused (positions vs order)", async () => {
    await expect(
      m.People.findById(P.ann)
        .populate({ path: "friends", retainNullValues: true, options: { sort: { name: 1 } } })
        .exec(),
    ).rejects.toThrow(/retainNullValues keeps positions/);
  });

  test("perDocumentLimit on a single reference is refused like limit", async () => {
    await expect(m.People.findById(P.ann).populate({ path: "company", perDocumentLimit: 1 }).exec()).rejects.toThrow(
      /populate "company": a single reference holds one document; options perDocumentLimit apply to reference arrays only/,
    );
  });

  test("sort, limit or skip on a single reference is refused before the populate query (not silently ignored)", async () => {
    for (const options of [{ skip: 1 }, { limit: 1 }, { sort: { name: 1 } }] as const) {
      const before = finds().length;
      await expect(m.People.findById(P.ann).populate({ path: "company", options }).exec()).rejects.toThrow(
        /populate "company": a single reference holds one document; options (skip|limit|sort) apply to reference arrays only/,
      );
      /* Only the owner query ran: the populate is planned (and refused) before its own query. */
      expect(finds().length - before).toBe(1);
    }
    /* The same options on a reference array stay valid. */
    const doc = await m.People.findById(P.ann)
      .populate({ path: "friends", options: { sort: { name: -1 }, limit: 1 } })
      .orFail()
      .lean();
    expect(doc.friends.length).toBe(1);
  });

  test("limit and perDocumentLimit together are refused", async () => {
    await expect(
      m.People.findById(P.ann)
        .populate({ path: "friends", options: { limit: 1 }, perDocumentLimit: 1 })
        .exec(),
    ).rejects.toThrow(/give one/);
  });
});

describe("self references and several paths", () => {
  test("several paths: one query each", async () => {
    const docs = await m.People.find({ _id: { $in: [P.bob, P.cid] } })
      .sort({ name: 1 })
      .populate(["mentor", "friends", "company"])
      .lean();
    expect(finds().length).toBe(4);
    expect(docs[0]?.mentor?.name).toBe("ann");
    expect(docs[1]?.friends[0]?.name).toBe("ann");
    expect(ids(docs)).toEqual([P.bob.toHexString(), P.cid.toHexString()]);
  });

  test("a document found for several owners of one path is ONE object (no copy)", async () => {
    const posts = await m.Posts.find({ author: P.ann }).populate("author").lean();
    expect(posts.length).toBe(3);
    expect(posts[0]?.author).toBe(posts[1]?.author);
    expect(finds().length).toBe(2);
  });

  test("dotted path through references populates each level", async () => {
    const doc = await m.People.findById(P.bob).populate("mentor.company").orFail().lean();
    expect(doc.mentor?.company?.name).toBe("acme");
  });

  test("a document of the same class: hydrated populated documents are documents of their model", async () => {
    const bob = await m.People.findById(P.bob).populate("mentor").orFail();
    expect(bob.mentor).toBeInstanceOf(Person);
    expect(bob.mentor?.greet()).toBe("hi ann");
    const mentor = bob.mentor;
    if (mentor === null || mentor === undefined) throw new Error("no mentor");
    mentor.age = 31;
    await mentor.$save();
    expect((await m.People.findById(P.ann).orFail().lean()).age).toBe(31);
    expect(bob.$isModified()).toBe(false);
  });
});
