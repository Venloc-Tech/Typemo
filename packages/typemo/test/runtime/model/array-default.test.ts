/*
 * An array field without `required` and without `default` starts as `[]`, as in Mongoose: create, `Model.new`,
 * an upsert's insert, a new subdocument, and a stored document read without the key (hydrated: the default is a
 * change the next save writes; lean: the stored document as it is). A `required` array has no default. Real server.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Entity, type Model, Prop, Schema, ValidationError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A line with its own array. */
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => [String]) notes!: string[];
}

/** Arrays without options, with `required`, nullable, of subdocuments, and with an explicit default. */
@Schema({ collection: "f101_posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [String], { required: true }) authors!: string[];
  @Prop(() => [Number], { nullable: true }) scores!: number[] | null;
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => [String], { default: () => ["draft"] }) labels!: string[];
}

const t = ModelLifecycle.useTypemo("f101_arrays");
let Posts: Model<Post>;
const raw = () => t.mongo.db.collection("f101_posts");

beforeEach(async () => {
  Posts = t.connection.model(Post);
  await raw().deleteMany({});
});

describe("an array without required and default starts as []", () => {
  test("create stores [] for every such array; an explicit default wins; a new subdocument gets its own", async () => {
    const post = await Posts.create({ title: "a", authors: ["ann"], lines: [{ sku: "x" }] });
    expect([...post.tags]).toEqual([]);
    const stored = await raw().findOne({ _id: post._id });
    expect(stored?.tags).toEqual([]);
    expect(stored?.scores).toEqual([]);
    expect(stored?.labels).toEqual(["draft"]);
    expect(stored?.lines?.[0]?.notes).toEqual([]);
  });

  test("Model.new has the arrays before any save", () => {
    const post = Posts.new({ title: "a", authors: [] });
    expect([...post.tags]).toEqual([]);
    expect(post.$toObject().lines).toEqual([]);
  });

  test("a required array has no default: missing is a ValidationError", async () => {
    /* The create type makes every array optional (the class type cannot show `required`): the run time refuses. */
    await expect(Posts.create({ title: "a" })).rejects.toBeInstanceOf(ValidationError);
    await expect(Posts.create({ title: "a" })).rejects.toThrow(/"authors": the field is required/);
  });

  test("an upsert's insert gets [] ($setOnInsert)", async () => {
    await Posts.updateOne({ title: "u" }, { $set: { authors: ["bo"] } }, { upsert: true });
    const stored = await raw().findOne({ title: "u" });
    expect(stored?.tags).toEqual([]);
    expect(stored?.lines).toEqual([]);
  });

  test("a stored document without the key: hydrated has [] (saved by the next save), lean is as stored", async () => {
    const { insertedId } = await raw().insertOne({ title: "old", authors: ["cid"] });
    const lean = await Posts.findById(insertedId).lean().orFail();
    expect("tags" in lean).toBe(false);
    const doc = await Posts.findById(insertedId).orFail();
    expect([...doc.tags]).toEqual([]);
    expect(doc.$isModified("tags")).toBe(true);
    await doc.$save();
    expect((await raw().findOne({ _id: insertedId }))?.tags).toEqual([]);
  });
});
