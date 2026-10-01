/*
 * Ported from mongoose test/document.test.js, test/document.modified.test.js and test/timestamps.test.js
 * onto Typemo. Mongoose's `doc.x = {…}` of a subdocument is `doc.$set("x", {…})`
 * here (a direct assignment of a container is refused); `toObject({ transform })` is a FINAL transform
 * of the whole result (divergence L5A-2); Mongoose's `$isNew` property is the method `$isNew()`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { UUID } from "mongodb";
import { Entity, type Model, Prop, Schema, Timestamped } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema()
class Named extends Entity {
  @Prop(() => String)
  name?: string;
}

@Schema({ collection: "p_doc_transforms" })
class WithSubs extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Named])
  docArr?: Named[];

  @Prop(() => Named)
  subdoc?: Named;
}

@Schema()
class Result {
  @Prop(() => Number)
  score?: number;

  @Prop(() => Boolean)
  passed?: boolean;
}

@Schema({ collection: "p_doc_results" })
class Exam extends Entity {
  @Prop(() => Result)
  result?: Result;
}

@Schema({ collection: "p_doc_users" })
class User extends Entity {
  @Prop(() => String)
  name?: string;
}

@Schema({ collection: "p_doc_posts" })
class Post extends Entity {
  @Prop(() => String)
  title?: string;

  @Prop(() => Date)
  date?: Date;

  @Prop(() => [Number])
  numbers?: number[];

  @Prop(() => [Named])
  comments?: Named[];
}

@Schema({ nested: true })
class Sub {
  @Prop(() => Number)
  height?: number;
}

@Schema({ collection: "p_doc_heights" })
class Height extends Entity {
  @Prop(() => Sub)
  sub?: Sub;
}

@Schema()
class UuidSub {
  @Prop(() => UUID)
  _id?: UUID;
}

@Schema({ nested: true })
class UuidNested {
  @Prop(() => UUID)
  uuid?: UUID;
}

@Schema({ collection: "p_doc_uuids" })
class UuidUser {
  @Prop(() => UUID)
  _id!: UUID;

  @Prop(() => UUID)
  uuid?: UUID;

  @Prop(() => UuidNested)
  nested?: UuidNested;

  @Prop(() => UuidSub)
  subdocument?: UuidSub;

  @Prop(() => [UuidSub])
  documentArray?: UuidSub[];
}

@Schema({ collection: "p_doc_cats" })
class Cat extends Timestamped(Entity) {
  @Prop(() => String)
  name?: string;

  @Prop(() => String)
  hobby?: string;
}

const t = ModelLifecycle.useTypemo("ported_document");

describe("document (ported)", () => {
  // ported from mongoose test/document.test.js:566 "propagates toObject transform function to all subdocuments (gh-14589)"
  test("gh-14589: a transform sees the whole plain result, subdocuments included (divergence L5A-2)", () => {
    const doc = t.connection
      .model(WithSubs)
      .new({ name: "test", docArr: [{ name: "test" }], subdoc: { name: "test" } });
    // Mongoose calls the transform once per (sub)document; Typemo once, on the whole result (its return
    // value is the typed result). Deleting every `_id` is done on that one object:
    const obj = doc.$toObject({
      transform: (ret) => {
        const { _id, ...rest } = ret;
        return {
          ...rest,
          subdoc: rest.subdoc === undefined ? undefined : { name: rest.subdoc.name },
          docArr: rest.docArr?.map((item) => ({ name: item.name })),
        };
      },
    });
    expect(obj).not.toHaveProperty("_id");
    expect(obj.subdoc).toEqual({ name: "test" });
    expect(obj.docArr?.[0]).toEqual({ name: "test" });
  });

  // ported from mongoose test/document.test.js:1254 "toObject should not set undefined values to null"
  test("toObject should not set undefined values to null", () => {
    const doc = t.connection.model(Post).new({});
    const { _id, ...obj } = doc.$toObject();
    expect(_id).toBeDefined();
    expect(obj).toEqual({ comments: [], numbers: [] }); // arrays start as [] (as in Mongoose); nothing is null
  });

  // ported from mongoose test/document.test.js:5057 "nested docs toObject() clones (gh-5008)"
  test("nested docs toObject() clones (gh-5008)", () => {
    const doc = t.connection.model(Height).new({ sub: { height: 3 } });
    expect(doc.sub?.height).toBe(3);
    const leanDoc = doc.$toObject();
    expect(leanDoc.sub?.height).toBe(3);
    if (doc.sub !== undefined) doc.sub.height = 55;
    expect(doc.sub?.height).toBe(55);
    expect(leanDoc.sub?.height).toBe(3);
  });

  // ported from mongoose test/document.test.js:7436 "converts UUIDs to strings in toJSON()"
  test("converts UUIDs to strings in toJSON() (always: the JSON form of a UUID, no flattenUUIDs option)", () => {
    const user = t.connection.model(UuidUser).new({
      _id: new UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      uuid: new UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
      nested: { uuid: new UUID("cccccccc-cccc-cccc-cccc-cccccccccccc") },
      subdocument: { _id: new UUID("dddddddd-dddd-dddd-dddd-dddddddddddd") },
      documentArray: [{ _id: new UUID("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee") }],
    });
    expect(user.$toJSON()).toEqual({
      _id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      nested: { uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
      subdocument: { _id: "dddddddd-dddd-dddd-dddd-dddddddddddd" },
      documentArray: [{ _id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" }],
    });
  });

  // ported from mongoose test/document.test.js:13430 "should not trigger isModified when setting a nested boolean to the same value as previously  (gh-12992)"
  test("should not trigger isModified when setting a nested boolean to the same value as previously (gh-12992)", async () => {
    const Exams = t.connection.model(Exam);
    const created = await Exams.create({ result: { score: 40, passed: false } });
    const existing = await Exams.findById(created._id).orFail();
    existing.$set("result", { score: 40, passed: false });
    expect(existing.$isModified()).toBe(false);
    existing.$set("result", { score: 40, passed: true });
    expect(existing.$isModified()).toBe(true);
  });

  // ported from mongoose test/document.test.js:10886 "is available as `$isModified`"
  test("is available as `$isModified`", async () => {
    const user = t.connection.model(User).new({ name: "Sam" });
    await user.$save();
    expect(user.$isModified()).toBe(false);
    user.name = "John";
    expect(user.$isModified()).toBe(true);
  });

  // ported from mongoose test/document.test.js:10912 "is available as `$isNew`"
  test("is available as `$isNew`", async () => {
    const user = t.connection.model(User).new({ name: "Sam" });
    expect(user.$isNew()).toBe(true);
    await user.$save();
    expect(user.$isNew()).toBe(false);
  });
});

describe("modified (ported)", () => {
  // ported from mongoose test/document.modified.test.js:90 "reset after save"
  test("reset after save", async () => {
    const Posts = t.connection.model(Post);
    const b = Posts.new({ numbers: [] });
    b.numbers?.push(3);
    await b.$save();
    b.numbers?.push(3);
    await b.$save();
    expect((await Posts.findById(b._id).orFail()).numbers?.length).toBe(2);
  });

  // ported from mongoose test/document.modified.test.js:104 "of embedded docs reset after save"
  test("of embedded docs reset after save", async () => {
    const post = t.connection.model(Post).new({ title: "hocus pocus", comments: [] });
    post.comments?.push({ name: "Humpty Dumpty" });
    await post.$save();
    expect(post.$isModified("comments.0.name")).toBe(false);
    expect(post.$isModified("title")).toBe(false);
  });

  // ported from mongoose test/document.modified.test.js:136 "when modifying keys"
  test("when modifying keys", async () => {
    const Posts = t.connection.model(Post);
    const created = await Posts.create({ title: "Test", date: new Date() });
    const post = await Posts.findById(created._id).orFail();
    expect(post.$isModified("title")).toBe(false);
    post.$set("title", "test");
    expect(post.$isModified("title")).toBe(true);
    expect(post.$isModified("date")).toBe(false);
    post.$set("date", new Date((post.date as Date).getTime() + 10));
    expect(post.$isModified("date")).toBe(true);
  });

  // ported from mongoose test/document.modified.test.js:155 "setting a key identically to its current value should not dirty the key"
  test("setting a key identically to its current value should not dirty the key", async () => {
    const Posts = t.connection.model(Post);
    const created = await Posts.create({ title: "Test" });
    const post = await Posts.findById(created._id).orFail();
    post.$set("title", "Test");
    expect(post.$isModified("title")).toBe(false);
  });
});

describe("timestamps (ported)", () => {
  let Cats: Model<Cat>;
  beforeEach(async () => {
    Cats = t.connection.model(Cat);
    await Cats.create({ name: "newcat" });
  });

  // ported from mongoose test/timestamps.test.js:478 "should not override createdAt when not selected (gh-4340)"
  test("should not override createdAt when not selected (gh-4340)", async () => {
    const created = await Cats.create({ name: "hello" });
    const createdAt = created.createdAt;
    const updatedAt = created.updatedAt;
    expect(created.createdAt).toBeDefined();
    const doc = await Cats.findById(created._id).select({ name: 1 }).orFail();
    // The dates are not selected — and not in the projection's type either.
    expect((doc as unknown as { createdAt?: Date }).createdAt).toBeUndefined();
    /* cast: bypasses the type to test the runtime guard — fields outside the projection are not in its type */
    expect((doc as unknown as { updatedAt?: Date }).updatedAt).toBeUndefined();
    doc.name = "world";
    await Bun.sleep(2);
    await doc.$save();
    // the projection's type has no timestamps (not selected); the save set updatedAt at run time
    const saved = doc as unknown as { createdAt?: Date; updatedAt?: Date };
    const newUpdatedAt = saved.updatedAt;
    expect(saved.createdAt).toBeUndefined();
    expect(saved.updatedAt).toBeDefined();
    const again = await Cats.findById(created._id).orFail();
    expect(again.createdAt.valueOf()).toBe(createdAt.valueOf());
    expect(again.updatedAt.valueOf()).not.toBe(updatedAt.valueOf());
    expect(again.updatedAt.getTime()).toBe(newUpdatedAt?.getTime() ?? Number.NaN);
  });

  // ported from mongoose test/timestamps.test.js:529 "should have fields when create"
  test("should have fields when create", async () => {
    const doc = await Cats.new({ name: "newcat" }).$save();
    expect(doc.createdAt).toBeDefined();
    expect(doc.createdAt.getTime()).toBe(doc.updatedAt.getTime());
  });

  // ported from mongoose test/timestamps.test.js:551 "sets timestamps on replaceOne (gh-9951)"
  test("replaceOne keeps createdAt and bumps updatedAt (Mongoose gh-9951 set both: divergence L5A-3)", async () => {
    await Cats.deleteMany({ name: { $exists: true } });
    const { _id, createdAt } = await Cats.create({ name: "notexistname" });
    await Bun.sleep(2);
    await Cats.replaceOne({ name: "notexistname" }, {});
    const docs = await Cats.find({});
    expect(docs.length).toBe(1);
    const [doc] = docs;
    expect(doc?._id.toHexString()).toBe(_id.toHexString());
    expect(doc?.createdAt.getTime()).toBe(createdAt.getTime());
    expect((doc?.updatedAt.getTime() ?? 0) > createdAt.getTime()).toBe(true);
  });

  // ported from mongoose test/timestamps.test.js:564 "should change updatedAt when save"
  test("should change updatedAt when save", async () => {
    const doc = await Cats.findOne({ name: "newcat" }).orFail();
    const old = doc.updatedAt;
    doc.hobby = "coding";
    await Bun.sleep(2);
    await doc.$save();
    expect(doc.updatedAt.getTime() > old.getTime()).toBe(true);
  });

  // ported from mongoose test/timestamps.test.js:574 "should not change updatedAt when save with no modifications"
  test("should not change updatedAt when save with no modifications", async () => {
    const doc = await Cats.findOne({ name: "newcat" }).orFail();
    const old = doc.updatedAt;
    await doc.$save();
    expect(doc.updatedAt.getTime()).toBe(old.getTime());
  });
});
