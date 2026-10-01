/*
 * Ported from mongoose test/document.populate.test.js: `doc.populate()`,
 * `doc.populated()`, `doc.depopulate()` → `$populate`, `$populated`, `$depopulate`. The logic is kept;
 * where Mongoose mutates a populated array in place (push/pull of documents), Typemo's populated view is
 * read-only and the change goes through `$depopulate` / `$set` (divergence L6-3).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { ObjectId } from "mongodb";
import { QueryError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { BandPerson, MBlogPost, MemberBand, MUser } from "../../fixtures/populate/ported-entities.ts";

const t = ModelLifecycle.useTypemo("p_document_populate");

beforeEach(async () => {
  for (const name of ["pmp_users", "pmp_blogposts", "pmp_band_people", "pmp_bands_with_members"]) {
    await t.mongo.db.collection(name).deleteMany({});
  }
});

const seedPost = async () => {
  const users = t.connection.model(MUser);
  const posts = t.connection.model(MBlogPost);
  const [u1, u2] = await users.create([
    { name: "Phoenix", email: "phx@az.com", blogposts: [], followers: [] },
    { name: "Newark", email: "ewr@nj.com", blogposts: [], followers: [] },
  ]);
  const post = await posts.create({
    title: "the how and why",
    _creator: u1?._id as ObjectId,
    fans: [u1?._id as ObjectId, u2?._id as ObjectId],
    comments: [],
  });
  return { posts, post };
};

describe("document: populate", () => {
  // ported from mongoose test/document.populate.test.js:306 "a property not in schema"
  test("a property not in schema", async () => {
    const { posts, post } = await seedPost();
    const p = await posts.findById(post._id).orFail();
    await expect(p.$populate("idontexist" as never)).rejects.toThrow(QueryError);
  });

  // ported from mongoose test/document.populate.test.js:313 "of empty array"
  test("of empty array", async () => {
    const { posts, post } = await seedPost();
    const p = await posts.findById(post._id).orFail();
    p.$set("fans", []);
    const populated = await p.$populate("fans");
    expect(populated.fans).toEqual([]);
  });

  // ported from mongoose test/document.populate.test.js:326 "of null property"
  test("of null property", async () => {
    const { posts, post } = await seedPost();
    const p = await posts.findById(post._id).orFail();
    p.$set("_creator", null);
    const populated = await p.$populate("_creator");
    expect(populated._creator).toBeNull();
  });

  // ported from mongoose test/document.populate.test.js:162 "works with await"
  test("works with await", async () => {
    const { posts, post } = await seedPost();
    const p = await posts.findById(post._id).orFail();
    const populated = await p.$populate("_creator");
    expect(populated as unknown).toBe(p); // the same document, typed with the populated field
    expect(populated._creator?.name).toBe("Phoenix");
    expect(p.$populated("_creator")?.toString()).toBe(post._creator?.toString());
  });

  // ported from mongoose test/document.populate.test.js:198 "using multiple populate calls"
  test("using multiple populate calls", async () => {
    const { posts, post } = await seedPost();
    const p = await posts.findById(post._id).orFail();
    const once = await p.$populate("_creator");
    const twice = await once.$populate({ path: "fans", select: { name: 1 } });
    expect(twice._creator?.name).toBe("Phoenix");
    expect(twice.fans.map((fan) => fan.name)).toEqual(["Phoenix", "Newark"]);
    expect(twice.fans.every((fan) => !Object.hasOwn(fan, "email"))).toBe(true);
  });
});

describe("document: depopulate", () => {
  const seedBand = async () => {
    const people = await t.connection.model(BandPerson).create([{ name: "Axl Rose" }, { name: "Slash" }]);
    const ids = people.map((person) => person._id);
    const band = await t.connection
      .model(MemberBand)
      .create({ name: "Guns N' Roses", members: ids, lead: ids[0] as ObjectId });
    return { ids, band };
  };

  // ported from mongoose test/document.populate.test.js:544 "can depopulate specific path (gh-2509)"
  test("can depopulate specific path (gh-2509)", async () => {
    const { ids, band } = await seedBand();
    const withMembers = await band.$populate("members");
    expect(withMembers.members[0]?.name).toBe("Axl Rose");
    const plain = withMembers.$depopulate("members");
    expect(plain.members.map(String)).toEqual(ids.map(String));
    expect(typeof plain.members.addToSet).toBe("function"); // the tracked array again
    expect(plain.$getChanges()).toEqual({});
    expect(plain.$populated("members")).toBeUndefined();
    expect(plain.$populated("lead")).toBeUndefined();
    const withLead = await plain.$populate("lead");
    expect(withLead.lead?.name).toBe("Axl Rose");
    const noLead = withLead.$depopulate("lead");
    expect(noLead.$getChanges()).toEqual({});
    expect(String(noLead.lead)).toBe(String(ids[0]));
    const other = new (await import("mongodb")).ObjectId();
    noLead.$set("lead", other);
    expect(noLead.$getChanges()).toEqual({ $set: { lead: other } });
  });

  // ported from mongoose test/document.populate.test.js:606 "depopulates all (gh-6073)"
  test("depopulates all (gh-6073)", async () => {
    const { band } = await seedBand();
    const populated = await (await band.$populate("members")).$populate("lead");
    expect(populated.$populated("members")).toBeDefined();
    expect(populated.$populated("lead")).toBeDefined();
    const depopulated = populated.$depopulate();
    expect(depopulated.$populated("members")).toBeUndefined();
    expect(depopulated.$populated("lead")).toBeUndefined();
  });

  // ported from mongoose test/document.populate.test.js:636 "doesn't throw when called on a doc that is not populated (gh-6075)"
  test("doesn't throw when called on a doc that is not populated (gh-6075)", async () => {
    const person = await t.connection.model(BandPerson).create({ name: "Greg Dulli" });
    expect(person.$depopulate()).toBe(person as never);
  });

  // ported from mongoose test/document.populate.test.js:739 "depopulates after pushing manually populated (gh-2509)"
  // DIVERGENCE L6-3: Mongoose pushes a DOCUMENT into the populated array; Typemo's populated view is read-only —
  // the references change after `$depopulate` (the tracked array of ids), the result is the same.
  test("depopulates, then changes the references (gh-2509, divergence L6-3)", async () => {
    const { ids, band } = await seedBand();
    const extra = await t.connection.model(BandPerson).create({ name: "Duff" });
    const populated = await band.$populate("members");
    /* cast: bypasses the type to test the runtime guard — a populated array is read-only (no push in the type) */
    expect(() => (populated.members as unknown as { push(x: unknown): void }).push(extra)).toThrow(QueryError);
    const plain = populated.$depopulate("members");
    plain.members.push(extra._id);
    expect(plain.$populated("members")).toBeUndefined();
    await plain.$save();
    const reloaded = await t.connection.model(MemberBand).findById(band._id).orFail();
    expect(reloaded.members.map(String)).toEqual([...ids, extra._id].map(String));
    const again = await reloaded.$populate("members");
    const back = again.$depopulate();
    back.members.pull(ids[0] as ObjectId);
    await back.$save();
    expect((await t.connection.model(MemberBand).findById(band._id).orFail()).members.map(String)).toEqual(
      [ids[1], extra._id].map(String),
    );
  });

  /* Own test (not ported): a second $populate of a populated path reads the related documents again. */
  test("$populate of a populated path re-populates it: the related documents are read anew", async () => {
    const { ids, band } = await seedBand();
    const first = await band.$populate("members");
    const firstNames = first.members.map((member) => member.name);
    await t.connection.model(BandPerson).updateOne({ _id: ids[0] as ObjectId }, { $set: { name: "Renamed" } });
    const second = await first.$populate("members");
    expect(second.members.map((member) => member.name)).toEqual(["Renamed", ...firstNames.slice(1)]);
    expect((second.$populated("members") as ObjectId[]).map(String)).toEqual(ids.map(String));
  });
});
