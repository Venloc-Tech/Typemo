/*
 * Mongoose's populate `clone` tests ported. In Typemo `clone` is an option of
 * the object form (`populate({ path, clone: true })`), not `options.clone`; off by default.
 */
import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { Documents } from "../../../src/document/documents.ts";
import { Entity, Prop, type Ref, Schema, Types } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("ported_clone");

@Schema({ collection: "pc_users" })
class User extends Entity {
  @Prop(() => String) name?: string;
}

@Schema({ collection: "pc_posts" })
class BlogPost extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => User }) user?: Ref<User>;
  @Prop(() => String) title?: string;
}

describe("populate clone (ported from test/model.populate.test.js)", () => {
  // ported from mongoose test/model.populate.test.js:7632 "clone option means identical ids get separate copies of doc (gh-3258)"
  test("clone option means identical ids get separate copies of doc (gh-3258)", async () => {
    const user = await t.connection.model(User).create({ name: "val" });
    const Posts = t.connection.model(BlogPost);
    await Posts.create([
      { title: "test1", user: user._id },
      { title: "test2", user: user._id },
    ]);
    const posts = await Posts.find().sort({ title: 1 }).populate({ path: "user", clone: true });
    posts[0]?.user?.$set("name", "val2");
    expect(posts[1]?.user?.name).toBe("val");
  });

  // ported from mongoose test/model.populate.test.js:9175 "clone with lean creates identical copies from the same document"
  test("clone with lean creates identical copies from the same document (gh-8760)", async () => {
    const user = await t.connection.model(User).create({ name: "val" });
    const Posts = t.connection.model(BlogPost);
    await Posts.create([
      { title: "test1", user: user._id },
      { title: "test2", user: user._id },
      { title: "test3", user: new ObjectId() },
    ]);
    const posts = await Posts.find().populate({ path: "user", clone: true }).sort({ title: 1 }).lean();
    const first = posts[0]?.user;
    if (first) first.name = "val2";
    expect(posts[1]?.user?.name).toBe("val");
    expect(posts[2]?.user).toBeNull();
  });

  // ported from mongoose test/model.populate.test.js:9201 "clone with populate and lean makes child lean"
  test("clone with populate and lean makes child lean (gh-8760)", async () => {
    const user = await t.connection.model(User).create({ name: "val" });
    const Posts = t.connection.model(BlogPost);
    await Posts.create({ title: "test1", user: user._id });
    const post = await Posts.findOne().populate({ path: "user", clone: true }).orFail().lean();
    expect(post.user).not.toBeNull();
    expect(Documents.is(post.user)).toBe(false);
  });
});
