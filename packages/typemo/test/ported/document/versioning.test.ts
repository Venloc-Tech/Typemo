/*
 * Ported from mongoose test/versioning.test.js onto Typemo: the version key protects
 * positional array changes (WHERE) and counts length/order changes (INC); `optimisticConcurrency` makes
 * every change conditional. Mongoose's `arr: []` (Mixed) becomes a string array here (no Mixed type in
 * Typemo); `$__delta()` checks become checks of the command the server received (CommandRecorder).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { ObjectId } from "mongodb";
import { Entity, type Model, Prop, Schema, Types, VersionError, Versioned } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema()
class Comment {
  @Prop(() => String)
  title?: string;

  @Prop(() => [String])
  likedBy?: string[];
}

@Schema({ nested: true })
class Meta {
  @Prop(() => [Number])
  numbers?: number[];

  @Prop(() => [Comment])
  nested?: Comment[];
}

@Schema({ collection: "p_versioning_posts" })
class BlogPost extends Versioned(Entity) {
  @Prop(() => String)
  title?: string;

  @Prop(() => Meta)
  meta?: Meta;

  @Prop(() => [String])
  arr?: string[];

  @Prop(() => [[String]])
  matrix?: string[][];

  @Prop(() => [Comment])
  comments?: Comment[];

  @Prop(() => [Types.ObjectId])
  unreadPosts?: ObjectId[];
}

@Schema({ collection: "p_versioning_things", optimisticConcurrency: true })
class Thing extends Versioned(Entity) {
  @Prop(() => Number)
  price?: number;

  @Prop(() => String)
  name?: string;
}

const t = ModelLifecycle.useTypemo("ported_versioning");
let Posts: Model<BlogPost>;
let Things: Model<Thing>;

beforeEach(() => {
  Posts = t.connection.model(BlogPost);
  Things = t.connection.model(Thing);
});

const reload = (id: ObjectId) => Posts.findById(id).orFail();

describe("versioning (ported)", () => {
  // ported from mongoose test/versioning.test.js:184 "allows concurrent push"
  test("allows concurrent push", async () => {
    const a = await Posts.create({ meta: { numbers: [] } });
    const b = await reload(a._id);
    expect(a.__v).toBe(0);
    a.meta?.numbers?.push(2);
    b.meta?.numbers?.push(4);
    await a.$save();
    await b.$save();
    const stored = await reload(a._id);
    expect(stored.$toObject().meta?.numbers).toEqual([2, 4]);
    expect(stored.__v).toBe(2);
  });

  // ported from mongoose test/versioning.test.js:207 "allows concurrent push and pull"
  test("allows concurrent push and pull", async () => {
    const a = await Posts.create({ meta: { numbers: [2, 4, 6, 8] } });
    const b = await reload(a._id);
    a.meta?.numbers?.pull(2);
    b.meta?.numbers?.push(10);
    await a.$save();
    await b.$save();
    const stored = await reload(a._id);
    expect(stored.$toObject().meta?.numbers).toEqual([4, 6, 8, 10]);
    expect(stored.__v).toBe(2);
  });

  // ported from mongoose test/versioning.test.js:230 "throws if you set a positional path after pulling"
  test("throws if you set a positional path after pulling", async () => {
    const a = await Posts.create({ meta: { numbers: [2, 4, 6, 8] } });
    const b = await reload(a._id);
    a.meta?.numbers?.pull(4, 6);
    b.$set("meta.numbers.2", 7);
    await a.$save();
    const error = await b.$save().then(
      () => null,
      (caught: unknown) => caught,
    );
    // Mongoose: "No matching document" (a VersionError); Typemo: VersionError
    expect(error).toBeInstanceOf(VersionError);
    expect((await reload(a._id)).__v).toBe(1);
  });

  // ported from mongoose test/versioning.test.js:253 "allows pull/push after $set"
  test("allows pull/push after $set", async () => {
    const a = await Posts.create({ arr: ["test1", "10"] });
    const b = await reload(a._id);
    a.$set("arr.0", "not an array");
    // should overwrite a's changes, last write wins
    b.arr?.pull("10");
    b.arr?.addToSet("using set");
    await a.$save();
    await b.$save();
    expect((await reload(a._id)).$toObject().arr).toEqual(["test1", "using set"]);
  });

  // ported from mongoose test/versioning.test.js:275 "should add version to where clause"
  test("should add version to where clause", async () => {
    const a = await Posts.create({ matrix: [["before update"]] });
    expect(a.__v).toBe(0);
    t.commands.clear();
    a.$set("matrix.0.0", "updated");
    await a.$save();
    const sent = t.commands.byName("update")[0]?.command.updates[0];
    expect(sent.q.__v).toBe(0); // version should be added to where clause
    expect(sent.u.$inc).toBeUndefined();
    const stored = await reload(a._id);
    expect(stored.matrix?.[0]?.[0]).toBe("updated");
    expect(stored.__v).toBe(0);
  });

  // ported from mongoose test/versioning.test.js:296 "$set after pull/push throws"
  test("$set after pull/push throws", async () => {
    const a = await Posts.create({ arr: ["test1", "using set"] });
    const b = await reload(a._id);
    b.$set("arr.0", "not an array");
    // force a $set
    a.arr?.pull("using set");
    a.arr?.push("woot", "woot2");
    a.arr?.pop();
    await a.$save();
    await expect(b.$save()).rejects.toThrow(VersionError);
  });

  // ported from mongoose test/versioning.test.js:318 "doesnt persist conflicting changes"
  test("doesnt persist conflicting changes", async () => {
    const a = await Posts.create({ meta: { nested: [{ title: "test1" }, { title: "test2" }] } });
    const b = await reload(a._id);
    a.meta?.nested?.pop();
    b.meta?.nested?.pop();
    await a.$save();
    await expect(b.$save()).rejects.toThrow(VersionError);
  });

  // ported from mongoose test/versioning.test.js:336 "increments version on push"
  test("increments version on push", async () => {
    const a = await Posts.create({ meta: { nested: [] } });
    const b = await reload(a._id);
    a.meta?.nested?.push({ title: "test1" });
    a.meta?.nested?.push({ title: "test2" });
    b.meta?.nested?.push({ title: "test3" });
    await a.$save();
    await b.$save();
    const stored = await reload(a._id);
    expect(stored.__v).toBe(2);
    expect(stored.meta?.nested?.map((comment) => comment.title)).toEqual(["test1", "test2", "test3"]);
  });

  // ported from mongoose test/versioning.test.js:480 "should persist correctly when optimisticConcurrency is true gh-10128"
  test("should persist correctly when optimisticConcurrency is true gh-10128", async () => {
    const thing = await Things.create({ price: 1 });
    await thing.$save();
    expect(thing.__v).toBe(0);
    const thing1 = await Things.findById(thing._id).orFail();
    const thing2 = await Things.findById(thing._id).orFail();
    thing1.price = 2;
    await thing1.$save();
    expect(thing1.__v).toBe(1);
    // Divergence L5A-1: Mongoose throws VersionError here — `price = 1` is the value thing2 was READ with, so
    // Mongoose's save without changes still checks the version (gh-11295/H466). In Typemo it is no change
    // (H501) and an empty save sends nothing. A real change of the stale document is refused:
    thing2.price = 1;
    t.commands.clear();
    await thing2.$save();
    expect(t.commands.all()).toEqual([]);
    thing2.price = 3;
    const error = await thing2.$save().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as Error).name).toBe("VersionError");
  });

  // ported from mongoose test/versioning.test.js:497 "throws VersionError when saving with no changes and optimistic concurrency is true (gh-11295)"
  test("gh-11295: saving the stored value back is no change — nothing is sent (divergence L5A-1)", async () => {
    const entry = await Things.create({ name: "WallE" });
    const changes = await Things.findById(entry._id).orFail();
    const other = await Things.findById(entry._id).orFail();
    changes.name = "John";
    await changes.$save();
    other.name = "WallE"; // the value it was read with: not a change (H501), and an empty save sends nothing
    t.commands.clear();
    await other.$save();
    expect(t.commands.all()).toEqual([]);
    expect((await Things.findById(entry._id).orFail()).name).toBe("John");
  });

  // ported from mongoose test/versioning.test.js:561 "pull doesnt add version where clause (gh-6190)"
  test("pull doesnt add version where clause (gh-6190)", async () => {
    const id1 = new Types.ObjectId();
    const id2 = new Types.ObjectId();
    const doc = await Posts.create({ unreadPosts: [id1, id2] });
    const doc1 = await reload(doc._id);
    const doc2 = await reload(doc._id);
    doc1.unreadPosts?.pull(id1);
    await doc1.$save();
    doc2.unreadPosts?.pull(id2);
    await doc2.$save();
    expect((await reload(doc._id)).unreadPosts?.length).toBe(0);
  });

  // ported from mongoose test/versioning.test.js:601 "optimistic concurrency (gh-9001) (gh-5424)"
  test("optimistic concurrency (gh-9001) (gh-5424)", async () => {
    await Things.create({ name: "foo" });
    const d1 = await Things.findOne().orFail();
    const d2 = await Things.findOne().orFail();
    d1.name = "bar";
    await d1.$save();
    d2.name = "qux";
    await expect(d2.$save()).rejects.toThrow(VersionError);
  });

  // ported from mongoose test/versioning.test.js:622 "adds version to filter if pushing to a nested array (gh-11108)"
  test("adds version to filter if pushing to a nested array (gh-11108)", async () => {
    const entry = await Posts.create({ comments: [{ likedBy: ["Friends", "Family"] }] });
    const post1 = await reload(entry._id);
    const post2 = await reload(entry._id);
    post1.$set("comments", [{ likedBy: ["test"] }]);
    await post1.$save();
    post2.comments?.[0]?.likedBy?.push("Some User");
    const error = await post2.$save().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as Error).name).toBe("VersionError");
    const post3 = await reload(entry._id);
    post3.comments?.[0]?.likedBy?.push("Some User");
    await post3.$save();
    expect(post3.__v).toBe(2);
  });
});
