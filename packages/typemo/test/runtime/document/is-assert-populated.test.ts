/*
 * On the real server: `doc.$is(Class)` tells the discriminator class of a document read
 * through the base model (by the discriminator value it was read with), `doc.$assertPopulated(path)` checks
 * that a path holds populated values and returns the same document.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { QueryError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { Event, Person, Purchase, Signup } from "../../fixtures/populate/populate-entities.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("is_assert");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

describe("$is(Class)", () => {
  test("a document of the base model is exactly the class its discriminator value selected", async () => {
    const [buy, join] = await m.Events.find().sort({ label: 1 }).orFail();
    expect(join?.$is(Signup)).toBe(true);
    expect(join?.$is(Purchase)).toBe(false);
    expect(buy?.$is(Purchase)).toBe(true);
    expect(buy?.$is(Signup)).toBe(false);
    /* the root class: every document of the hierarchy */
    expect(join?.$is(Event)).toBe(true);
  });

  test("narrowed, the discriminator's own reference is populated", async () => {
    const event = await m.Events.findOne({ label: "join" }).orFail();
    if (!event.$is(Signup)) throw new Error("expected a signup");
    const populated = await event.$populate("user");
    expect(populated.user?.name).toBe("ann");
    expect(Object.is(populated, event)).toBe(true);
  });

  test("a document read through the discriminator model, and a new one", async () => {
    const signup = await m.Signups.findOne().orFail();
    expect(signup.$is(Signup)).toBe(true);
    expect(signup.$is(Event)).toBe(true);
    const fresh = m.Signups.new({ label: "x", user: P.bob });
    expect(fresh.$is(Signup) && !fresh.$is(Purchase)).toBe(true);
    /* hydrate() of the base model picks the class by the stored value (not by the class the caller expects) */
    const raw = await t.mongo.db.collection("pp_events").findOne({ __t: "purchase" });
    expect(m.Events.hydrate(raw ?? {}).$is(Purchase)).toBe(true);
  });

  test("a class outside the hierarchy is an error, not a silent false", async () => {
    const event = await m.Events.findOne().orFail();
    // biome-ignore lint/suspicious/noExplicitAny: a class of another model passed on purpose (JS callers).
    expect(() => event.$is(Person as any)).toThrow(QueryError);
    expect(() => event.$is(Person as never)).toThrow(/Person is not Event or one of its discriminators/);
    expect(() => event.$is("signup" as never)).toThrow(/a class of the document's hierarchy/);
  });
});

describe("$assertPopulated(path | object | list)", () => {
  test("not populated: a QueryError naming the path; populated: the same document", async () => {
    const ann = await m.People.findById(P.ann).orFail();
    expect(() => ann.$assertPopulated("company")).toThrow(QueryError);
    expect(() => ann.$assertPopulated("company")).toThrow(/"company" of Person is not populated/);
    /* populated by a side effect the type cannot see (a hook, a helper): `ann` is still typed unpopulated */
    await ann.$populate("company");
    const asserted = ann.$assertPopulated("company");
    expect(Object.is(asserted, ann)).toBe(true);
    expect(asserted.company?.name).toBe("acme");
  });

  test("a reference that found nothing is populated (null / absent element), like $populated", async () => {
    const dan = await m.People.findById(P.dan).orFail();
    await dan.$populate("company");
    expect(dan.$assertPopulated("company").company).toBeNull();
    const ann = await m.People.findById(P.ann).orFail();
    await ann.$populate("friends");
    expect(ann.$assertPopulated("friends").friends.map((friend) => friend.name)).toEqual(["bob", "cid"]);
  });

  test("the object form checks its path; the options only type the result", async () => {
    const ann = await m.People.findById(P.ann).orFail();
    await ann.$populate({ path: "company", select: { name: 1 } });
    expect(ann.$assertPopulated({ path: "company", select: { name: 1 } }).company?.name).toBe("acme");
    const bob = await m.People.findById(P.bob).orFail();
    expect(() => bob.$assertPopulated({ path: "mentor" })).toThrow(/"mentor" of Person is not populated/);
  });

  test("a dotted path: every document on the way must have the rest populated", async () => {
    const bob = await m.People.findById(P.bob).orFail();
    await bob.$populate("mentor.company");
    expect(bob.$assertPopulated("mentor.company").mentor?.company?.name).toBe("acme");
    const shallow = await m.People.findById(P.bob).orFail();
    await shallow.$populate("mentor");
    expect(() => shallow.$assertPopulated("mentor.company")).toThrow(/"mentor\.company" of Person is not populated/);
    /* three levels */
    const comment = await m.Comments.findById(P.c1).orFail();
    await comment.$populate("post.author.company");
    expect(comment.$assertPopulated("post.author.company").post?.author?.company?.name).toBe("acme");
    const twoLevels = await m.Comments.findById(P.c1).orFail();
    await twoLevels.$populate("post.author");
    expect(() => twoLevels.$assertPopulated("post.author.company")).toThrow(/"post\.author\.company"/);
    const none = await m.People.findById(P.bob).orFail();
    expect(() => none.$assertPopulated("mentor.company")).toThrow(/"mentor\.company" of Person is not populated/);
  });

  test("after $depopulate the path is not populated any more", async () => {
    const ann = await m.People.findById(P.ann).orFail();
    await ann.$populate("company");
    ann.$depopulate("company");
    expect(() => ann.$assertPopulated("company")).toThrow(/not populated/);
  });

  test("a bad argument is an error", async () => {
    const ann = await m.People.findById(P.ann).orFail();
    expect(() => ann.$assertPopulated("" as never)).toThrow(/a populate path/);
    expect(() => ann.$assertPopulated({} as never)).toThrow(/a populate path/);
    expect(() => ann.$assertPopulated([] as never)).toThrow(/a populate path, \{ path \}, or a list of them/);
    expect(() => ann.$assertPopulated(["company", 1] as never)).toThrow(/a populate path/);
  });

  test("a list: every element is asserted, the same list $populate takes", async () => {
    const ann = await m.People.findById(P.ann).orFail();
    await ann.$populate(["company", { path: "friends", select: { name: 1 } }]);
    const asserted = ann.$assertPopulated(["company", { path: "friends", select: { name: 1 } }]);
    expect(Object.is(asserted, ann)).toBe(true);
    expect(asserted.company?.name).toBe("acme");
    expect(asserted.friends.map((friend) => friend.name)).toEqual(["bob", "cid"]);
    /* one element not populated: the error names it */
    const half = await m.People.findById(P.ann).orFail();
    await half.$populate("company");
    expect(() => half.$assertPopulated(["company", "friends"])).toThrow(/"friends" of Person is not populated/);
  });

  test("an object with a nested populate asserts the nested path too (the type says it is populated)", async () => {
    const bob = await m.People.findById(P.bob).orFail();
    await bob.$populate("mentor");
    expect(() => bob.$assertPopulated({ path: "mentor", populate: "company" })).toThrow(
      /"mentor\.company" of Person is not populated/,
    );
    await bob.$populate({ path: "mentor", populate: "company" });
    expect(bob.$assertPopulated({ path: "mentor", populate: "company" }).mentor?.company?.name).toBe("acme");
  });
});
