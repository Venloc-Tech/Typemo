/*
 * Ported from mongoose test/model.populate.test.js (one or more tests per populate variant).
 * The logic of each test is kept; Mongoose's positional/space-separated signatures
 * become the object form (`populate('fans', 'name', match, options)` → `{ path, select, match, options }`),
 * `isInit(path)` becomes "the key is not loaded". Divergences are marked in the test and in
 * test/ported/INDEX.md / from-mongoose-to-typemo/DIVERGENCES.md (L6-*).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId, UUID } from "mongodb";
import { QueryError, StrictModeError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import {
  Author,
  Band,
  Category,
  Child,
  DateActivity,
  EventActivity,
  Family,
  FriendPost,
  FriendUser,
  Game,
  Item1,
  Item2,
  Kid,
  Level1,
  Level2,
  Level3,
  Level4,
  MActivity,
  MapUser,
  MBlogPost,
  Media,
  MediaArticle,
  Movie,
  MUser,
  Musician,
  NumberArticle,
  NumberNote,
  NumberPerson,
  NumberPost,
  NumberUser,
  Offer,
  Parent,
  Player,
  Review,
  Row,
  Story,
  StringNote,
  StringUser,
  Team,
  Thing,
  ThingList,
  TimedA,
  TimedB,
  UuidNode,
  UuidRoot,
  Writer,
} from "../../fixtures/populate/ported-entities.ts";

const t = ModelLifecycle.useTypemo("p_model_populate");
const model = {
  model: <T extends object>(entity: Parameters<typeof t.connection.model<T>>[0]) => t.connection.model<T>(entity),
};

beforeEach(async () => {
  for (const name of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    await t.mongo.db.collection(name.name).deleteMany({});
  }
});

const users = () => model.model(MUser);
const posts = () => model.model(MBlogPost);

describe("model: populate: single references", () => {
  // ported from mongoose test/model.populate.test.js:256 "populating a single ref"
  test("populating a single ref", async () => {
    const creator = await users().create({
      name: "Guillermo",
      email: "rauchg@gmail.com",
      blogposts: [],
      followers: [],
    });
    const post = await posts().create({ title: "woot", _creator: creator._id, comments: [], fans: [] });
    const populated = await posts().findById(post._id).populate("_creator").orFail();
    expect(populated._creator).toBeInstanceOf(MUser);
    expect(populated._creator?.name).toBe("Guillermo");
    expect(populated._creator?.email).toBe("rauchg@gmail.com");
  });

  // ported from mongoose test/model.populate.test.js:277 "not failing on null as ref"
  test("not failing on null as ref", async () => {
    const created = await posts().create({ title: "woot", _creator: null, comments: [], fans: [] });
    const found = await posts().findById(created._id).populate("_creator").orFail();
    expect(found._creator).toBeNull();
  });

  // ported from mongoose test/model.populate.test.js:364 "populating with partial fields selection"
  test("populating with partial fields selection", async () => {
    const creator = await users().create({
      name: "Guillermo",
      email: "rauchg@gmail.com",
      blogposts: [],
      followers: [],
    });
    const post = await posts().create({ title: "woot", _creator: creator._id, comments: [], fans: [] });
    const found = await posts()
      .findById(post._id)
      .populate({ path: "_creator", select: { email: 1 } })
      .orFail();
    expect(found._creator).toBeInstanceOf(MUser);
    expect(Object.hasOwn(found._creator ?? {}, "name")).toBe(false); // isInit('name') === false
    expect(found._creator?.email).toBe("rauchg@gmail.com");
  });

  // ported from mongoose test/model.populate.test.js:388 "population of single oid with partial field selection and filter"
  test("population of single oid with partial field selection and filter", async () => {
    const creator = await users().create({ name: "Banana", email: "cats@example.com", blogposts: [], followers: [] });
    const post = await posts().create({ title: "woot", _creator: creator._id, comments: [], fans: [] });
    const post2 = await posts()
      .findById(post._id)
      .populate({ path: "_creator", select: { email: 1 }, match: { name: "Peanut" } })
      .orFail();
    expect(post2._creator).toBeNull();
    const post3 = await posts()
      .findById(post._id)
      .populate({ path: "_creator", select: { email: 1 }, match: { name: "Banana" } })
      .orFail();
    expect(post3._creator).toBeInstanceOf(MUser);
    expect(Object.hasOwn(post3._creator ?? {}, "name")).toBe(false);
    expect(post3._creator?.email).toBe("cats@example.com");
  });

  // ported from mongoose test/model.populate.test.js:419 "population of undefined fields in a collection of docs"
  test("population of undefined fields in a collection of docs", async () => {
    const user = await users().create({ name: "Eloy", email: "eloytoro@gmail.com", blogposts: [], followers: [] });
    await posts().create({ title: "I have a user ref", _creator: user._id, comments: [], fans: [] });
    await posts().create({ title: "I don't", comments: [], fans: [] });
    const found = await posts().find().populate("_creator");
    for (const post of found) if ("_creator" in post) expect(post._creator).not.toBeNull();
  });

  // ported from mongoose test/model.populate.test.js:2957 "maps results back to correct document (gh-1444)"
  test("maps results back to correct document (gh-1444)", async () => {
    const media = await model.model(Media).create({ filename: "one" });
    await model.model(MediaArticle).create([
      { body: "body1", author: "a" },
      { body: "body2", author: "a", mediaAttach: media._id },
      { body: "body3", author: "a" },
    ]);
    const docs = await model.model(MediaArticle).find().populate("mediaAttach");
    const a2 = docs.find((doc) => doc.body === "body2");
    expect(a2?.mediaAttach?._id.equals(media._id)).toBe(true);
  });

  // ported from mongoose test/model.populate.test.js:1555 "populate should work on String _ids"
  test("populate should work on String _ids", async () => {
    await model.model(StringUser).create({ _id: "alice", name: "Alice" });
    const note = await model.model(StringNote).create({ author: "alice", body: "Buy Milk" });
    const populated = await model.model(StringNote).findById(note._id).populate("author").orFail();
    expect(populated.body).toBe("Buy Milk");
    expect(populated.author?.name).toBe("Alice");
  });

  // ported from mongoose test/model.populate.test.js:1639 "populate should work on Number _ids"
  test("populate should work on Number _ids", async () => {
    await model.model(NumberUser).create({ _id: 2359, name: "Alice" });
    const created = await model.model(NumberNote).create({ author: 2359, body: "Buy Milk" });
    const note = await model.model(NumberNote).findById(created._id).populate("author").orFail();
    expect(note.body).toBe("Buy Milk");
    expect(note.author?.name).toBe("Alice");
  });

  // ported from mongoose test/model.populate.test.js:11633 "handles populating uuids (gh-14869)"
  test("handles populating uuids (gh-14869)", async () => {
    const node = await model
      .model(UuidNode)
      .create({ _id: new UUID("65c7953e-c6e9-4c2f-8328-fe2de7df560d"), name: "test" });
    const root = await model.model(UuidRoot).create({
      _id: new UUID("05c7953e-c6e9-4c2f-8328-fe2de7df560d"),
      status: "ok",
      node: [node._id],
    });
    const found = await model.model(UuidRoot).findById(root._id).populate("node").orFail();
    let doc = found.$toJSON({ getters: true });
    expect(doc._id).toBe("05c7953e-c6e9-4c2f-8328-fe2de7df560d");
    expect(doc.node.length).toBe(1);
    expect(doc.node[0]?._id).toBe("65c7953e-c6e9-4c2f-8328-fe2de7df560d");
    const plain = found.$toObject({ getters: true });
    expect(plain._id.toString()).toBe("05c7953e-c6e9-4c2f-8328-fe2de7df560d");
    expect(plain.node[0]?._id.toString()).toBe("65c7953e-c6e9-4c2f-8328-fe2de7df560d");
    doc = found.$toJSON();
    expect(doc.node.length).toBe(1);
  });
});

describe("model: populate: arrays of references", () => {
  const twoFans = async () => {
    const fan1 = await users().create({ name: "Fan 1", email: "fan1@learnboost.com", blogposts: [], followers: [] });
    const fan2 = await users().create({ name: "Fan 2", email: "fan2@learnboost.com", blogposts: [], followers: [] });
    const post1 = await posts().create({ title: "Woot", fans: [fan1._id, fan2._id], comments: [] });
    const post2 = await posts().create({ title: "Woot", fans: [fan2._id, fan1._id], comments: [] });
    return { fan1, fan2, post1, post2 };
  };

  // ported from mongoose test/model.populate.test.js:571 "populating an array of refs and fetching many"
  test("populating an array of refs and fetching many", async () => {
    const { post1, post2 } = await twoFans();
    const found = await posts()
      .find({ _id: { $in: [post1._id, post2._id] } })
      .sort({ _id: 1 })
      .populate("fans");
    expect(found[0]?.fans.map((fan) => [fan.name, fan.email])).toEqual([
      ["Fan 1", "fan1@learnboost.com"],
      ["Fan 2", "fan2@learnboost.com"],
    ]);
    expect(found[1]?.fans.map((fan) => fan.name)).toEqual(["Fan 2", "Fan 1"]);
  });

  // ported from mongoose test/model.populate.test.js:652 "populating an array of references with fields selection"
  test("populating an array of references with fields selection", async () => {
    const { post1, post2 } = await twoFans();
    const found = await posts()
      .find({ _id: { $in: [post1._id, post2._id] } })
      .sort({ _id: 1 })
      .populate({ path: "fans", select: { name: 1 } });
    expect(found[0]?.fans.map((fan) => fan.name)).toEqual(["Fan 1", "Fan 2"]);
    expect(found[0]?.fans.every((fan) => !Object.hasOwn(fan, "email"))).toBe(true);
    expect(found[1]?.fans.map((fan) => fan.name)).toEqual(["Fan 2", "Fan 1"]);
  });

  // ported from mongoose test/model.populate.test.js:691 "populating an array of references and filtering"
  test("populating an array of references and filtering", async () => {
    const fan1 = await users().create({ name: "Fan 1", email: "fan1@learnboost.com", blogposts: [], followers: [] });
    const fan2 = await users().create({ name: "Fan 2", gender: "female", blogposts: [], followers: [] });
    const fan3 = await users().create({ name: "Fan 3", gender: "female", blogposts: [], followers: [] });
    const post1 = await posts().create({ title: "Woot", fans: [fan1._id, fan2._id, fan3._id], comments: [] });
    const post2 = await posts().create({ title: "Woot", fans: [fan3._id, fan2._id, fan1._id], comments: [] });
    const found = await posts()
      .find({ _id: { $in: [post1._id, post2._id] } })
      .sort({ _id: 1 })
      .populate({ path: "fans", match: { gender: "female", _id: { $in: [fan2._id] } } });
    expect(found.map((post) => post.fans.map((fan) => fan.name))).toEqual([["Fan 2"], ["Fan 2"]]);
    const found2 = await posts()
      .find({ _id: { $in: [post1._id, post2._id] } })
      .sort({ _id: 1 })
      .populate({ path: "fans", match: { gender: "female" } });
    expect(found2.map((post) => post.fans.map((fan) => fan.name))).toEqual([
      ["Fan 2", "Fan 3"],
      ["Fan 3", "Fan 2"],
    ]);
  });

  // ported from mongoose test/model.populate.test.js:1296 "supports `retainNullValues` to override filtering out null docs (gh-6432)"
  test("supports retainNullValues to override filtering out null docs (gh-6432)", async () => {
    const user = await users().create({ name: "Victor Hugo", blogposts: [], followers: [] });
    const post = await posts().create({ title: "Notre-Dame de Paris", fans: [], comments: [] });
    // Typemo: `undefined` is never stored (strict by default); the raw array has nulls and a dangling id instead.
    await t.mongo.db
      .collection("pmp_blogposts")
      .updateOne({ _id: post._id }, { $set: { fans: [null, user._id, null, new ObjectId()] } });
    const returned = await posts().findById(post._id).populate({ path: "fans", retainNullValues: true }).orFail();
    expect(returned.fans.length).toBe(4);
    expect(returned.fans[0]).toBeNull();
    expect(returned.fans[1]?.name).toBe("Victor Hugo");
    expect(returned.fans[2]).toBeNull();
    expect(returned.fans[3]).toBeNull();
  });

  // ported from mongoose test/model.populate.test.js:1468 "passing sort options to the populate method"
  test("passing sort options to the populate method", async () => {
    const [fan1, fan2, fan3, fan4] = await users().create([
      { name: "aaron", age: 10, blogposts: [], followers: [] },
      { name: "fan2", age: 8, blogposts: [], followers: [] },
      { name: "someone else", age: 3, blogposts: [], followers: [] },
      { name: "val", age: 3, blogposts: [], followers: [] },
    ]);
    const ids = [fan4, fan2, fan3, fan1].map((fan) => fan?._id as ObjectId);
    const post = await posts().create({ fans: ids, comments: [] });
    let populated = await posts()
      .findById(post._id)
      .populate({ path: "fans", options: { sort: { age: 1, name: 1 } } })
      .orFail();
    expect(populated.fans.map((fan) => fan.name)).toEqual(["someone else", "val", "fan2", "aaron"]);
    const named = await posts()
      .findById(post._id)
      .populate({ path: "fans", select: { name: 1 }, options: { sort: { name: -1 } } })
      .orFail();
    expect(named.fans.map((fan) => fan.name)).toEqual(["val", "someone else", "fan2", "aaron"]);
    expect(named.fans.every((fan) => !Object.hasOwn(fan, "age"))).toBe(true);
    populated = await posts()
      .findById(post._id)
      .populate({ path: "fans", match: { age: { $gt: 3 } }, options: { sort: { name: "desc" } } })
      .orFail();
    expect(populated.fans.map((fan) => fan.age)).toEqual([8, 10]);
  });

  // ported from mongoose test/model.populate.test.js:1511 "limit should apply to each returned doc, not in aggregate (gh-1490)"
  test("limit should apply to each returned doc, not in aggregate (gh-1490)", async () => {
    const things = await model.model(Thing).create([1, 2, 3, 4, 5].map((n) => ({ name: `thing${n}` })));
    const id = (index: number) => things[index]?._id as ObjectId;
    await model.model(ThingList).create([{ b: [id(0), id(1), id(4)] }, { b: [id(2), id(3), id(4)] }]);
    const lists = await model
      .model(ThingList)
      .find()
      .populate({ path: "b", options: { limit: 2 } });
    expect(lists.length).toBe(2);
    expect(lists[0]?.b.length).toBe(2);
    expect(lists[1]?.b.length).toBe(2);
  });

  // ported from mongoose test/model.populate.test.js:1159 "properly handles limit per document (gh-2151)"
  test("properly handles limit per document (gh-2151)", async () => {
    const ids = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
    const others = (index: number) => ids.filter((_, position) => position !== index);
    await model.model(FriendUser).create(
      ["mary", "bob", "joe", "sally"].map((name, index) => ({
        _id: ids[index] as ObjectId,
        name,
        friends: others(index),
      })),
    );
    await model.model(FriendPost).create([
      { title: "blog 1", tags: ["fun", "cool"], author: ids[3] as ObjectId },
      { title: "blog 2", tags: ["cool"], author: ids[1] as ObjectId },
      { title: "blog 3", tags: ["fun", "odd"], author: ids[2] as ObjectId },
    ]);
    const opts = Object.freeze({ path: "author.friends", select: { name: 1 }, options: { limit: 1 } } as const);
    const docs = await model.model(FriendPost).find({ tags: "fun" }).lean().populate(opts);
    expect(docs.length).toBe(2);
    expect(docs[0]?.author?.friends.length).toBe(1);
    expect(docs[1]?.author?.friends.length).toBe(1);
    expect(opts.options.limit).toBe(1); // the options object is not mutated
  });

  // ported from mongoose test/model.populate.test.js:2987 "handles skip"
  test("handles skip", async () => {
    const movies = await model.model(Movie).create([{}, {}, {}]);
    await model.model(Category).create({ movies: movies.map((movie) => movie._id) });
    const category = await model
      .model(Category)
      .findOne()
      .populate({ path: "movies", options: { limit: 2, skip: 1 } })
      .orFail();
    expect(category.movies.length).toBe(2);
  });

  // ported from mongoose test/model.populate.test.js:10730 "merges match when match is on `_id` (gh-12834)"
  test("merges match when match is on _id (gh-12834)", async () => {
    const stories = await model.model(Story).create([
      { _id: new ObjectId("0".repeat(24)), title: "The Fellowship of the Ring" },
      { _id: new ObjectId("1".repeat(24)), title: "Casino Royale" },
      { _id: new ObjectId("2".repeat(24)), title: "Live and Let Die" },
      { _id: new ObjectId("3".repeat(24)), title: "The Two Towers" },
    ]);
    const id = (index: number) => stories[index]?._id as ObjectId;
    const writer = await model.model(Writer).create({ name: "Ian Fleming", stories: [id(1), id(2)] });
    let person = await model
      .model(Writer)
      .findById(writer._id)
      .populate({ path: "stories", match: { _id: { $gte: id(2) } } })
      .orFail();
    expect(person.stories.map((story) => story.title)).toEqual(["Live and Let Die"]);
    person = await model
      .model(Writer)
      .findById(writer._id)
      .populate({ path: "stories", match: { _id: { $lte: id(1) } } })
      .orFail();
    expect(person.stories.map((story) => story.title)).toEqual(["Casino Royale"]);
    person = await model
      .model(Writer)
      .findById(writer._id)
      .populate({ path: "stories", match: { _id: id(1) } })
      .orFail();
    expect(person.stories.map((story) => story.title)).toEqual(["Casino Royale"]);
  });

  // ported from mongoose test/model.populate.test.js:8711 "top-level limit properly applies limit per document (gh-8657)"
  // DIVERGENCE L6-1: Mongoose's limit is "limit × number of documents" in one query — the second article gets
  // NOTHING (`[]`). Typemo's limit is per document, exactly: each article gets its first author.
  test("limit applies per document, exactly (gh-8657, divergence L6-1)", async () => {
    await model.model(NumberArticle).create([{ authors: [1, 2] }, { authors: [3, 4] }]);
    await model.model(NumberPerson).create([{ _id: 1 }, { _id: 2 }, { _id: 3 }, { _id: 4 }]);
    const res = await model
      .model(NumberArticle)
      .find()
      .sort({ _id: 1 })
      .populate({ path: "authors", options: { limit: 1, sort: { _id: 1 } } });
    expect(res.length).toBe(2);
    expect(res[0]?.authors.map((author) => author._id)).toEqual([1]);
    expect(res[1]?.authors.map((author) => author._id)).toEqual([3]); // Mongoose: []
  });
});

describe("model: populate: polymorphic (DynRef, refPath)", () => {
  const seedReviews = async () => {
    await model.model(Item1).create({ _id: 1, name: "Val" });
    await model.model(Item2).create({ _id: 2, otherName: "Val" });
    // Typemo: refPath is relative to the (sub)document holding the reference (Mongoose: from the root, "item.type").
    await model.model(Review).create({
      _id: 0,
      text: "Test",
      item: { id: 1, type: "Item1" },
      items: [
        { id: 1, type: "Item1" },
        { id: 2, type: "Item2" },
      ],
    });
  };

  // ported from mongoose test/model.populate.test.js:2363 "DynRef Simple populate"
  test("DynRef: simple populate", async () => {
    await seedReviews();
    const results = await model.model(Review).find().populate("item.id");
    expect(results.length).toBe(1);
    expect((results[0]?.item?.id as { name?: string } | undefined)?.name).toBe("Val");
  });

  // ported from mongoose test/model.populate.test.js:2371 "DynRef Array populate"
  test("DynRef: array populate", async () => {
    await seedReviews();
    const results = await model.model(Review).find().populate("items.id");
    const result = results[0];
    expect(result?.items.length).toBe(2);
    expect((result?.items[0]?.id as { name?: string } | undefined)?.name).toBe("Val");
    expect((result?.items[1]?.id as { otherName?: string } | undefined)?.otherName).toBe("Val");
  });

  // ported from mongoose test/model.populate.test.js:2768 "readable error with deselected refPath (gh-6834)"
  test("readable error with deselected refPath (gh-6834)", async () => {
    await model.model(Offer).create({ text: "special discount", city: "New York", formData: new ObjectId() });
    let threw = false;
    try {
      await model.model(Offer).findOne().select({ city: 0 }).populate("formData");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryError);
      expect((error as Error).message).toContain("refPath");
      threw = true;
    }
    expect(threw).toBe(true);
  });

  // ported from mongoose test/model.populate.test.js:10566 "handles refPath underneath map of subdocuments (gh-9359)"
  test("handles refPath underneath map of subdocuments (gh-9359)", async () => {
    const user = await model.model(MapUser).create({ name: "test" });
    const listId = new ObjectId().toHexString();
    await model.model(Row).create({ sortOrder: 1, values: { [listId]: { valueObject: user._id, refp: "MapUser" } } });
    const row = await model.model(Row).findOne().populate("values.$*.valueObject").orFail();
    expect(row.values?.get(listId)?.valueObject?.name).toBe("test");
  });

  // ported from mongoose test/model.populate.test.js:3124 "discriminator child schemas (gh-3878)"
  // Typemo: through the BASE model the path of one discriminator is a type error (the base class has no
  // `postedBy`); at run time each document is populated by its own schema (as Mongoose does).
  test("discriminator child schemas (gh-3878)", async () => {
    const user = await model.model(MapUser).create({ name: "val" });
    await model.model(DateActivity).create({ title: "test", postedBy: user._id });
    await model.model(EventActivity).create({ title: "test2", test: "test" });
    const results = await model
      .model(MActivity)
      .find()
      .sort({ title: 1 })
      .populate("postedBy" as never);
    expect(results.length).toBe(2);
    /* cast: bypasses the type to test the runtime guard — a discriminator's path through the base model */
    expect((results[0] as unknown as { postedBy: { name: string } }).postedBy.name).toBe("val");
  });
});

describe("model: populate: nested", () => {
  // ported from mongoose test/model.populate.test.js:3176 "deep populate single -> array (gh-3904)"
  test("deep populate single -> array (gh-3904)", async () => {
    const people = await model
      .model(Player)
      .create(["Shaq", "Kobe", "Horry", "Duncan", "Robinson", "Johnson"].map((name) => ({ name })));
    const id = (index: number) => people[index]?._id as ObjectId;
    const teams = await model.model(Team).create([
      { name: "Lakers", members: [id(0), id(1), id(2)] },
      { name: "Spurs", members: [id(3), id(4), id(5)] },
    ]);
    const game = await model
      .model(Game)
      .create({ team: teams[0]?._id as ObjectId, opponent: teams[1]?._id as ObjectId });
    const doc = await model
      .model(Game)
      .findById(game._id)
      .populate({ path: "team", select: { name: 1, members: 1 }, populate: { path: "members", select: { name: 1 } } })
      .orFail();
    expect(doc.$toObject().team?.members.map((member) => member.name)).toEqual(["Shaq", "Kobe", "Horry"]);
  });

  // ported from mongoose test/model.populate.test.js:3288 "4 level population (gh-3973)"
  test("4 level population (gh-3973)", async () => {
    const [l4] = await model.model(Level4).create([{ name: "level 4" }]);
    const [l3] = await model.model(Level3).create([{ name: "level 3", level4: [l4?._id as ObjectId] }]);
    const [l2] = await model.model(Level2).create([{ name: "level 2", level3: [l3?._id as ObjectId] }]);
    const [l1] = await model.model(Level1).create([{ name: "level 1", level2: [l2?._id as ObjectId] }]);
    const obj = await model
      .model(Level1)
      .findById(l1?._id as ObjectId)
      .populate({ path: "level2", populate: { path: "level3", populate: { path: "level4" } } })
      .orFail();
    expect(obj.level2[0]?.level3[0]?.level4[0]?.name).toBe("level 4");
  });

  // ported from mongoose test/model.populate.test.js:2084 "populating combined with lean (gh-1260): with find"
  test("populating combined with lean (gh-1260)", async () => {
    const [fan1, fan2] = await users().create([
      { name: "Fan 1", email: "fan1@learnboost.com", blogposts: [], followers: [] },
      { name: "Fan 2", email: "fan2@learnboost.com", blogposts: [], followers: [] },
    ]);
    const [post1, post2] = await posts().create([
      { title: "Woot", fans: [fan1?._id as ObjectId, fan2?._id as ObjectId], comments: [] },
      { title: "Woot2", fans: [fan2?._id as ObjectId, fan1?._id as ObjectId], comments: [] },
    ]);
    const found = await posts()
      .find({ _id: { $in: [post1?._id as ObjectId, post2?._id as ObjectId] } })
      .sort({ title: 1 })
      .populate("fans")
      .lean();
    expect(found[0]?.fans.map((fan) => fan.name)).toEqual(["Fan 1", "Fan 2"]);
    /* cast: bypasses the type to test the runtime guard — a lean populated document has no $save */
    expect(typeof (found[0]?.fans[0] as unknown as { $save?: unknown } | undefined)?.$save).toBe("undefined");
    const one = await posts()
      .findById(post1?._id as ObjectId)
      .lean()
      .populate("fans")
      .orFail();
    expect(one.fans).toEqual(found[0]?.fans ?? []);
  });

  // ported from mongoose test/model.populate.test.js:2157 "records paths and _ids used in population: with findOne"
  test("records paths and _ids used in population (populated())", async () => {
    const [fan1, fan2] = await users().create([
      { name: "Fan 1", blogposts: [], followers: [] },
      { name: "Fan 2", blogposts: [], followers: [] },
    ]);
    const post = await posts().create({
      title: "Woot",
      fans: [fan1?._id as ObjectId, fan2?._id as ObjectId],
      _creator: fan1?._id as ObjectId,
      comments: [],
    });
    const doc = await posts().findById(post._id).populate(["fans", "_creator"]).orFail();
    const fans = doc.$populated("fans") as ObjectId[];
    expect(Array.isArray(fans)).toBe(true);
    expect(fans.map(String)).toEqual([String(fan1?._id), String(fan2?._id)]);
    expect(String(doc.$populated("_creator"))).toBe(String(fan1?._id));
  });
});

describe("model: populate: virtuals (gh-2562)", () => {
  const seedBands = async () => {
    await model.model(Musician).create([
      { name: "Axl Rose", band: "Guns N' Roses" },
      { name: "Slash", band: "Guns N' Roses" },
      { name: "Vince Neil", band: "Motley Crue" },
      { name: "Nikki Sixx", band: "Motley Crue" },
    ]);
    await model.model(Band).create([
      { name: "Guns N' Roses", people: ["Axl Rose", "Slash"] },
      { name: "Motley Crue", people: ["Vince Neil", "Nikki Sixx"] },
    ]);
  };

  // ported from mongoose test/model.populate.test.js:3605 "basic populate virtuals"
  test("basic populate virtuals", async () => {
    await seedBands();
    const gnr = await model.model(Band).findOne({ name: "Guns N' Roses" }).populate("members").orFail();
    expect(gnr.members.length).toBe(2);
  });

  // ported from mongoose test/model.populate.test.js:3634 "match (gh-6787)"
  test("match (gh-6787)", async () => {
    await model.model(Musician).create(["BB", "AA", "AB", "BA"].map((name) => ({ name, band: "Test" })));
    await model.model(Band).create({ name: "Test", people: [] });
    const band = await model.model(Band).findOne().populate("aMembers").orFail();
    expect(band.aMembers.map((member) => member.name).sort()).toEqual(["AA", "AB"]);
  });

  // ported from mongoose test/model.populate.test.js:3661 "match prevents using $where"
  // Typemo: every form is refused before any query by the sanitize policy (StrictModeError), including a
  // class instance (Mongoose let it through because sift reads own properties; Typemo: not a filter object).
  test("match prevents using $where", async () => {
    await model.model(Band).create({ name: "x", people: [] });
    const where = { $where: "typeof console !== 'undefined' ? doesNotExist('foo') : true;" };
    await expect(
      model
        .model(Band)
        .findOne()
        .populate({ path: "members", match: () => where as never })
        .exec(),
    ).rejects.toThrow(StrictModeError);
    await expect(
      model
        .model(Band)
        .find()
        .populate({ path: "members", match: () => ({ $or: [where] }) as never })
        .exec(),
    ).rejects.toThrow(StrictModeError);
    await expect(
      model
        .model(Band)
        .find()
        .populate({ path: "members", match: () => ({ $and: [where] }) as never })
        .exec(),
    ).rejects.toThrow(StrictModeError);
    await expect(
      model
        .model(Band)
        .find()
        .populate({ path: "members", match: where as never })
        .exec(),
    ).rejects.toThrow(StrictModeError);
  });

  // ported from mongoose test/model.populate.test.js:3720 "multiple source docs"
  test("multiple source docs", async () => {
    await seedBands();
    const bands = await model
      .model(Band)
      .find()
      .sort({ name: 1 })
      .populate({ path: "members", options: { sort: { name: 1 } } });
    expect(bands.map((band) => [band.name, band.members.map((member) => member.name)])).toEqual([
      ["Guns N' Roses", ["Axl Rose", "Slash"]],
      ["Motley Crue", ["Nikki Sixx", "Vince Neil"]],
    ]);
  });

  // ported from mongoose test/model.populate.test.js:3783 "source array"
  test("source array", async () => {
    await seedBands();
    const bands = await model
      .model(Band)
      .find()
      .sort({ name: 1 })
      .populate({ path: "listed", options: { sort: { name: 1 } } });
    expect(bands.map((band) => band.listed.map((member) => member.name))).toEqual([
      ["Axl Rose", "Slash"],
      ["Nikki Sixx", "Vince Neil"],
    ]);
  });

  // ported from mongoose test/model.populate.test.js:4012 "justOne option (gh-4263)"
  test("justOne option (gh-4263)", async () => {
    await model.model(Author).create([
      { name: "Val", authored: [0] },
      { name: "Test", authored: [0] },
    ]);
    await model.model(NumberPost).create({ _id: 0, title: "Bacon is Great" });
    const post = await model.model(NumberPost).findOne({ _id: 0 }).populate("author").orFail();
    expect(Array.isArray(post.author)).toBe(false);
    expect(post.author?.name).toMatch(/^(Val|Test)$/);
  });

  // ported from mongoose test/model.populate.test.js:4048 "justOne + lean (gh-6234)"
  test("justOne + lean (gh-6234)", async () => {
    await model.model(Band).create([
      { name: "Guns N' Roses", people: [] },
      { name: "Motley Crue", people: [] },
    ]);
    for (const [name, band] of [
      ["Axl Rose", "Guns N' Roses"],
      ["Slash", "Guns N' Roses"],
      ["Vince Neil", "Motley Crue"],
      ["Nikki Sixx", "Motley Crue"],
    ] as const) {
      await model.model(Musician).create({ name, band });
    }
    // Typemo: "the first" per band is by an explicit order (natural order is not guaranteed by the server).
    const res = await model
      .model(Band)
      .find()
      .sort({ name: 1 })
      .populate({ path: "member", options: { sort: { _id: 1 } } })
      .lean();
    expect(res.map((band) => [band.name, band.member?.name])).toEqual([
      ["Guns N' Roses", "Axl Rose"],
      ["Motley Crue", "Vince Neil"],
    ]);
  });

  // ported from mongoose test/model.populate.test.js:4087 "sets empty array if lean with justOne = false and no results (gh-10992)"
  test("sets empty array if lean with justOne = false and no results (gh-10992)", async () => {
    await model.model(Band).create({ name: "Guns N' Roses", people: [] });
    const res = await model.model(Band).find().populate("members").lean();
    expect(res.length).toBe(1);
    expect(res[0]?.members).toEqual([]);
  });

  // ported from mongoose test/model.populate.test.js:4152 "with no results and justOne (gh-4284)"
  test("with no results and justOne (gh-4284)", async () => {
    await model.model(Author).create({ name: "Val", authored: [0] });
    await model.model(NumberPost).create([
      { _id: 0, title: "Bacon is Great" },
      { _id: 1, title: "Bacon is OK" },
    ]);
    const found = await model.model(NumberPost).find().sort({ title: 1 }).populate("author");
    expect(found[0]?.author?.name).toBe("Val");
    expect(found[1]?.author).toBeNull();
  });

  // ported from mongoose test/model.populate.test.js:4451 "with functions for match (gh-7397)"
  // Typemo: a match function is ONE QUERY PER DOCUMENT, server semantics.
  test("with functions for match (gh-7397)", async () => {
    const as = await model.model(TimedA).create([
      { name: "old", createdAt: new Date("2015-06-01") },
      { name: "newer", createdAt: new Date("2017-06-01") },
      { name: "newest", createdAt: new Date("2019-06-01") },
    ]);
    const ids = as.map((a) => a._id);
    await model.model(TimedB).create({ as: ids, minDate: new Date("2016-01-01") });
    const b = await model
      .model(TimedB)
      .findOne()
      .populate({ path: "as", match: (doc) => ({ createdAt: { $gte: doc.minDate as Date } }) })
      .orFail();
    expect(b.as.map((a) => a.name)).toEqual(["newer", "newest"]);
    await model.model(TimedB).create({ as: ids, minDate: new Date("2018-01-01") });
    const bs = await model
      .model(TimedB)
      .find()
      .sort({ minDate: 1 })
      .populate({ path: "as", match: (doc) => ({ createdAt: { $gte: doc.minDate as Date } }) });
    expect(bs.map((one) => one.as.map((a) => a.name))).toEqual([["newer", "newest"], ["newest"]]);
  });
});

describe("model: populate: count, skip/limit, perDocumentLimit, transform", () => {
  const seedChildren = async () => {
    const p = await model.model(Parent).create({ name: "test" });
    await model.model(Child).create([
      { _id: 1, parentId: p._id },
      { _id: 2, parentId: p._id },
      { _id: 3, parentId: p._id },
    ]);
    const p2 = await model.model(Parent).create({ name: "test2" });
    await model.model(Child).create([
      { _id: 4, parentId: p2._id },
      { _id: 5, parentId: p2._id },
    ]);
    return { p, p2 };
  };

  // ported from mongoose test/model.populate.test.js:7478 "count option (gh-4469) (gh-7380)"
  test("count option (gh-4469) (gh-7380)", async () => {
    const p = await model.model(Parent).create({ name: "test" });
    await model.model(Child).create([{ _id: 1, parentId: p._id }, { _id: 2, parentId: p._id }, { _id: 3 }]);
    let doc = await model.model(Parent).findOne().populate(["children", "childCount"]).orFail();
    expect(doc.childCount).toBe(2);
    expect(doc.children.length).toBe(2);
    const counted = await model.model(Parent).find().populate("childCount");
    expect(counted[0]?.childCount).toBe(2);
    /* cast: bypasses the type to test the runtime guard — a virtual not populated by this query holds nothing */
    expect((counted[0] as unknown as { children?: unknown }).children).toBeUndefined();
    const plain = await model.model(Parent).findOne().orFail();
    doc = (await plain.$populate("childCount")) as never;
    expect(doc.childCount).toBe(2);
  });

  // ported from mongoose test/model.populate.test.js:8620 "supports top-level match option (gh-8475)"
  test("the virtual's match and the call's match (gh-8475)", async () => {
    const p = await model.model(Parent).create({ name: "test" });
    await model.model(Child).create([
      { _id: 1, parentId: p._id },
      { _id: 2, parentId: p._id, deleted: true },
      { _id: 3, parentId: p._id, deleted: false },
    ]);
    let doc = await model.model(Parent).findOne().populate("liveChildCount").orFail();
    expect(doc.liveChildCount).toBe(2);
    // DIVERGENCE: Mongoose REPLACES the virtual's match by the call's (count 1: the deleted child);
    // Typemo combines them with $and: deleted ≠ true AND deleted = true → 0.
    doc = await model
      .model(Parent)
      .findOne()
      .populate({ path: "liveChildCount", match: { deleted: true } })
      .orFail();
    expect(doc.liveChildCount).toBe(0);
  });

  // ported from mongoose test/model.populate.test.js:8652 "supports top-level skip and limit options (gh-8445)"
  test("skip and limit options (gh-8445)", async () => {
    const { p, p2 } = await seedChildren();
    let doc = await model.model(Parent).findById(p._id).populate("window").orFail();
    expect(doc.window.map((child) => child._id)).toEqual([2, 3]);
    doc = await model
      .model(Parent)
      .findById(p._id)
      .populate({ path: "window", options: { skip: 2 } })
      .orFail();
    expect(doc.window.map((child) => child._id)).toEqual([3]);
    doc = await model
      .model(Parent)
      .findById(p._id)
      .populate({ path: "window", options: { skip: 0 } })
      .orFail();
    expect(doc.window.map((child) => child._id)).toEqual([1, 2]);
    doc = await model
      .model(Parent)
      .findById(p._id)
      .populate({ path: "window", options: { skip: 0, limit: 1 } })
      .orFail();
    expect(doc.window.map((child) => child._id)).toEqual([1]);
    const docs = await model
      .model(Parent)
      .find()
      .sort({ _id: 1 })
      .populate({ path: "window", options: { skip: 0, limit: 2 } });
    expect(docs.map((parent) => parent._id.toString())).toEqual([p._id.toString(), p2._id.toString()]);
    expect(docs.map((parent) => parent.window.map((child) => child._id))).toEqual([
      [1, 2],
      [4, 5],
    ]);
  });

  // ported from mongoose test/model.populate.test.js:8732 "correct limit with populate (gh-7318)"
  test("correct limit with populate (gh-7318)", async () => {
    await seedChildren();
    let docs = await model.model(Parent).find().sort({ _id: 1 }).populate("firstTwo");
    expect(docs.map((parent) => parent.firstTwo.map((child) => child._id))).toEqual([
      [1, 2],
      [4, 5],
    ]);
    docs = (await model
      .model(Parent)
      .find()
      .sort({ _id: 1 })
      .populate({ path: "firstTwo", perDocumentLimit: 1 })) as never;
    expect(docs.map((parent) => parent.firstTwo.map((child) => child._id))).toEqual([[1], [4]]);
  });

  // ported from mongoose test/model.populate.test.js:8785 "perDocumentLimit as option to `populate()` method (gh-7318) (gh-9418)"
  test("perDocumentLimit as option to populate() (gh-7318) (gh-9418)", async () => {
    await seedChildren();
    const docs = await model.model(Parent).find().sort({ _id: 1 }).populate({ path: "children", perDocumentLimit: 1 });
    expect(docs.map((parent) => parent.children.map((child) => child._id))).toEqual([[1], [4]]);
  });

  // ported from mongoose test/model.populate.test.js:9118 "throws an error when using limit with perDocumentLimit"
  test("throws an error when using limit with perDocumentLimit", async () => {
    await model.model(Parent).create({ name: "test" });
    await expect(
      model
        .model(Parent)
        .find()
        .populate({ path: "children", perDocumentLimit: 5, options: { limit: 10 } })
        .exec(),
    ).rejects.toThrow(QueryError);
  });

  // ported from mongoose test/model.populate.test.js:9752 "supports `transform` option (gh-3375)"
  test("supports transform option (gh-3375)", async () => {
    const kids = await model.model(Kid).create([{ name: "Luke" }, { name: "Leia" }]);
    const kidId = (index: number) => kids[index]?._id as ObjectId;
    let p = await model.model(Family).create({ name: "Anakin", children: [kidId(0), kidId(1)], child: kidId(0) });
    let called: { doc: { name?: string } | null; id: ObjectId }[] = [];
    const transform = (doc: { name?: string } | null, id: ObjectId) => {
      called.push({ doc, id });
      return id;
    };
    await model.model(Family).findById(p._id).populate({ path: "children", transform });
    expect(called.map((call) => [call.doc?.name, call.id.toHexString()])).toEqual([
      ["Luke", kidId(0).toHexString()],
      ["Leia", kidId(1).toHexString()],
    ]);
    called = [];
    await model.model(Family).findById(p._id).populate({ path: "child", transform });
    expect(called.map((call) => call.doc?.name)).toEqual(["Luke"]);
    const newId = new ObjectId();
    await model.model(Family).updateOne({ _id: p._id }, { $push: { children: newId } });
    called = [];
    const withMissing = await model.model(Family).findById(p._id).populate({ path: "children", transform }).orFail();
    expect(called.length).toBe(3);
    expect(called[2]?.doc).toBeNull();
    expect(called[2]?.id.toHexString()).toBe(newId.toHexString());
    expect(withMissing.children[2]?.toHexString()).toBe(newId.toHexString());
    await model.model(Family).updateOne({ _id: p._id }, { $set: { children: [kidId(0), kidId(0)] } });
    called = [];
    await model.model(Family).findById(p._id).populate({ path: "children", transform });
    expect(called.map((call) => call.id.toHexString())).toEqual([kidId(0).toHexString(), kidId(0).toHexString()]);
    await model.model(Family).updateOne({ _id: p._id }, { $set: { child: newId } });
    called = [];
    p = (await model.model(Family).findById(p._id).populate({ path: "child", transform }).orFail()) as never;
    expect(called.length).toBe(1);
    expect(called[0]?.doc).toBeNull();
    expect(called[0]?.id.toHexString()).toBe(newId.toHexString());
  });

  // ported from mongoose test/model.populate.test.js:9872 "transform to primitive (gh-10064)"
  test("transform to primitive (gh-10064)", async () => {
    const kids = await model.model(Kid).create([{ name: "Luke" }, { name: "Leia" }]);
    const created = await model
      .model(Family)
      .create({ children: kids.map((kid) => kid._id), child: kids[0]?._id as ObjectId });
    const getName = (doc: { name?: string } | null): string | null => (doc == null ? null : (doc.name ?? null));
    const doc = await model
      .model(Family)
      .findById(created._id)
      .populate([
        { path: "child", transform: getName },
        { path: "children", retainNullValues: true, transform: getName },
      ])
      .orFail();
    // The transform's result type is the field's type: no cast needed.
    expect(doc.child).toBe("Luke");
    expect([...doc.$toObject().children].sort().reverse()).toEqual(["Luke", "Leia"]);
  });

  // ported from mongoose test/model.populate.test.js:9902 "transform with virtual populate, justOne = true (gh-3375)"
  test("transform with virtual populate, justOne = true (gh-3375)", async () => {
    const p = await model.model(Family).create({ name: "Anakin", children: [] });
    await model.model(Kid).create({ name: "Luke", parentId: p._id });
    const called: { doc: unknown; id: unknown }[] = [];
    await model
      .model(Family)
      .findById(p._id)
      .populate({
        path: "firstKid",
        transform: (doc, id) => {
          called.push({ doc, id });
          return id;
        },
      });
    expect(called.length).toBe(1);
    expect(String((called[0]?.doc as { parentId: ObjectId } | undefined)?.parentId)).toBe(p._id.toHexString());
    expect(String(called[0]?.id)).toBe(p._id.toHexString());
  });

  // ported from mongoose test/model.populate.test.js:9939 "transform with virtual populate, justOne = false (gh-3375)"
  test("transform with virtual populate, justOne = false (gh-3375)", async () => {
    const p = await model.model(Family).create({ name: "Anakin", children: [] });
    await model.model(Kid).create([
      { name: "Luke", parentId: p._id },
      { name: "Leia", parentId: p._id },
    ]);
    const called: { doc: { name?: string }; id: unknown }[] = [];
    await model
      .model(Family)
      .findById(p._id)
      .populate({
        path: "kids",
        transform: (doc, id) => {
          called.push({ doc: doc as { name?: string }, id });
          return id;
        },
      });
    expect(called.map((call) => call.doc.name).sort()).toEqual(["Leia", "Luke"]);
    expect(called.every((call) => String(call.id) === p._id.toHexString())).toBe(true);
  });
});
