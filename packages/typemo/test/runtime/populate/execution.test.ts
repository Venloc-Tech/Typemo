/*
 * HOW populate runs, on the real server — match functions (one query per document), nested populate,
 * cursors (one query per path per driver batch, never per document), transactions (sequential, in the
 * transaction's session), large `$in` split in batches, read options inherited, find-and-modify, lean `find`
 * vs `findOne` through ONE post-processing, and the sub-queries nested under their operation for
 * instrumentation.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import type { InstrumentationEvent } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("pop_execution");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

/**
 * The names of the commands recorded so far.
 * @returns The command names in order.
 */
const commands = () => t.commands.all().map((command) => command.commandName);

describe("match as a function", () => {
  test("called with each document (its ids, not documents); one query per document", async () => {
    const seen: unknown[] = [];
    const people = await m.People.find({ _id: { $in: [P.ann, P.bob] } })
      .sort({ name: 1 })
      .populate({
        path: "friends",
        match: (person) => {
          seen.push(person.friends);
          return { name: { $ne: person.name === "ann" ? "bob" : "x" } };
        },
        populate: "company",
      })
      .lean();
    expect(people[0]?.friends.map((friend) => friend.name)).toEqual(["cid"]);
    expect(seen[0]).toEqual([P.bob, P.gone, P.cid]);
    /* ann has friends, bob none: ONE friends query (for ann); the nested company: cid has none → no query */
    expect(commands()).toEqual(["find", "find"]);
  });

  test("two documents with references → two queries, each with its own filter", async () => {
    await m.People.updateOne({ _id: P.bob }, { $set: { friends: [P.cid] } });
    t.commands.clear();
    await m.People.find({ _id: { $in: [P.ann, P.bob] } })
      .populate({ path: "friends", match: (person) => ({ age: { $ne: person.age ?? 0 } }) })
      .lean();
    expect(t.commands.byName("find").length).toBe(3);
  });
});

describe("nested populate", () => {
  test("object form: each level one query; select and options per level", async () => {
    const post = await m.Posts.findById(P.p1)
      .populate({
        path: "comments",
        select: { body: 1, author: 1, post: 1 },
        options: { sort: { body: -1 } },
        populate: { path: "author", select: { name: 1 } },
      })
      .orFail()
      .lean();
    expect(post.comments?.map((comment) => `${comment.body}:${comment.author?.name}`)).toEqual(["c2:cid", "c1:bob"]);
    expect(commands()).toEqual(["find", "find", "find"]);
  });

  test("three levels by a dotted path, hydrated", async () => {
    const comment = await m.Comments.findById(P.c1).populate("post.author.company").orFail();
    expect(comment.post?.author?.company?.name).toBe("acme");
    expect(comment.$isModified()).toBe(false);
  });

  test("a populated level is populated again on each owner (re-populate replaces)", async () => {
    const ann = await m.People.findById(P.ann)
      .populate({ path: "company", select: { name: 1 } })
      .orFail();
    expect(Object.keys(ann.company ?? {}).sort()).toEqual(["_id", "name"]);
    const again = await ann.$depopulate("company").$populate("company");
    expect(again.company?.size).toBe(10);
    /* populating a populated path again (untyped: the type asks for $depopulate first) replaces it */
    await (ann as unknown as { $populate(spec: unknown): Promise<unknown> }).$populate({
      path: "company",
      select: { size: 1 },
    });
    expect((ann.company as { name?: string } | null | undefined)?.name).toBeUndefined();
    expect(ann.$populated("company")).toEqual(P.acme);
  });
});

describe("$populate with a list of paths", () => {
  test("every path of the list (a string or an object) is populated, typed like the list of populate()", async () => {
    const ann = await m.People.findById(P.ann).orFail();
    const populated = await ann.$populate(["company", { path: "friends", select: { name: 1 } }]);
    expect(populated.company?.name).toBe("acme");
    expect(populated.friends.length).toBeGreaterThan(0);
    expect(Object.keys(populated.friends[0] ?? {}).sort()).toEqual(["_id", "name"]);
    expect(populated.$populated("company")).toEqual(P.acme);
  });
});

describe("cursors: one query per path per driver batch (no N+1)", () => {
  test("batchSize 2 over 4 people: 2 batches → 2 populate queries", async () => {
    const names: string[] = [];
    for await (const person of m.People.find().sort({ name: 1 }).batchSize(2).populate("company").cursor()) {
      names.push(`${person.name}:${person.company?.name ?? "-"}`);
    }
    expect(names).toEqual(["ann:acme", "bob:globex", "cid:-", "dan:-"]);
    const finds = t.commands.byName("find").length;
    const getMores = t.commands.byName("getMore").length;
    expect(finds - 1).toBeLessThanOrEqual(2); /* populate queries: at most one per batch */
    expect(getMores).toBeGreaterThanOrEqual(1);
  });

  test("hydrated cursor documents are populated before the post hooks (child knows its parent)", async () => {
    for await (const order of m.Orders.find({ _id: P.o1 }).populate("lines.product").cursor()) {
      expect(order.lines[0]?.$parent()).toBe(order);
      expect(order.lines[0]?.product?.name).toBe("pen");
    }
  });
});

describe("transactions and sessions", () => {
  test("inside a transaction the populate queries use its session, one after another", async () => {
    const lsids = new Set<string>();
    const result = await t.connection.transaction(async () => {
      const people = await m.People.find({ _id: { $in: [P.ann, P.bob] } }).populate([
        "company",
        "friends",
        "posts",
        "postCount",
      ]);
      for (const command of t.commands.all()) {
        const lsid = (command.command.lsid as { id?: { toString(format: string): string } } | undefined)?.id;
        if (lsid !== undefined) lsids.add(lsid.toString("hex"));
      }
      return people.map((person) => person.company?.name ?? null);
    });
    expect(result.sort()).toEqual(["acme", "globex"]);
    expect(lsids.size).toBe(1);
    expect(
      t.commands
        .all()
        .every((command) => command.command.txnNumber !== undefined || command.commandName === "commitTransaction"),
    ).toBe(true);
  });

  test("a transaction sees its own writes in populate", async () => {
    const created = new ObjectId();
    await t.connection.transaction(async () => {
      await m.Companies.insertOne({ _id: created, name: "newco" });
      await m.People.updateOne({ _id: P.cid }, { $set: { company: created } });
      const cid = await m.People.findById(P.cid).populate("company").orFail();
      expect(cid.company?.name).toBe("newco");
    });
  });

  test("an explicit session outside a transaction: the populate queries use it", async () => {
    const session = await m.People.startSession();
    try {
      await m.People.findById(P.ann).session(session).populate(["company", "friends"]);
      const sent = t.commands.byName("find");
      expect(sent.length).toBe(3);
      const ids = new Set(
        sent.map((command) => (command.command.lsid as { id: { toString(f: string): string } }).id.toString("hex")),
      );
      expect(ids.size).toBe(1);
    } finally {
      await session.endSession();
    }
  });
});

describe("large $in", () => {
  test("60 001 references are looked up in two queries; the result is complete", async () => {
    const ids = Array.from({ length: 60_001 }, () => new ObjectId());
    await t.mongo.db.collection("pp_tags").insertMany(ids.map((_id, index) => ({ _id, label: `t${index}` })));
    await t.mongo.db.collection("pp_posts").updateOne({ _id: P.p3 }, { $set: { tags: ids } });
    t.commands.clear();
    const post = await m.Posts.findById(P.p3).populate("tags").orFail().lean();
    expect(post.tags.length).toBe(60_001);
    expect(post.tags[60_000]?.label).toBe("t60000");
    expect(t.commands.byName("find").length).toBe(3);
  }, 60_000);
});

describe("options of the parent query", () => {
  test("readPreference and comment are inherited by the populate queries", async () => {
    await m.People.findById(P.ann).readPreference("primaryPreferred").comment("mine").populate("company").lean();
    const [, populate] = t.commands.byName("find");
    expect(populate?.command.comment).toBe("mine");
    expect((populate?.command.$readPreference as { mode?: string } | undefined)?.mode).toBe("primaryPreferred");
  });
});

describe("find-and-modify and the one post-processing of lean", () => {
  test("findOneAndUpdate(...).populate() populates the returned document", async () => {
    const bob = await m.People.findOneAndUpdate({ _id: P.bob }, { $set: { age: 41 } })
      .populate("mentor")
      .orFail()
      .lean();
    expect(bob.age).toBe(41);
    expect(bob.mentor?.name).toBe("ann");
  });

  test("lean find and lean findOne give the same populated shape (Mongoose's two paths differed, M8 #3)", async () => {
    const one = await m.People.findOne({ _id: P.ann }).populate(["company", "friends"]).orFail().lean();
    const [many] = await m.People.find({ _id: P.ann }).populate(["company", "friends"]).lean();
    expect(many).toEqual(one);
  });

  test("lean populate with nothing to find gives null / [] without an error", async () => {
    const dan = await m.People.findById(P.dan).populate(["company", "posts"]).orFail().lean();
    expect(dan.company).toBeNull();
    expect(dan.posts).toEqual([]);
  });
});

describe("instrumentation", () => {
  test("populate sub-queries are operations nested under the query (parentId)", async () => {
    const events: InstrumentationEvent[] = [];
    const subscription = t.client.instrument({ handle: (event) => events.push(event) });
    try {
      await m.People.findById(P.ann).populate("company");
    } finally {
      subscription.unsubscribe();
    }
    const starts = events.filter((event) => event.type === "operation.start");
    expect(starts.length).toBe(2);
    const [parent, child] = starts;
    expect(child?.parentId).toBe(parent?.operationId);
  });
});
