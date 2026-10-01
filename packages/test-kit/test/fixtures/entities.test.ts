/* Tests the entity fixtures: they round-trip through a real collection. */
import { expect, test } from "bun:test";
import { MongoLifecycle } from "../../src/db/lifecycle.ts";
import { AllBsonTypesFixture } from "../../src/fixtures/all-bson-types.ts";
import { CommentFixture } from "../../src/fixtures/comment.ts";
import { PostFixture } from "../../src/fixtures/post.ts";
import { UserFixture } from "../../src/fixtures/user.ts";

/* See db/lifecycle.test.ts for why `db`/`client` aren't destructured here. */
const mongo = MongoLifecycle.useMongo("fixtures_entities_demo");

test("User <-> Post cyclic reference round-trips through a real collection", async () => {
  const { db } = mongo;
  const user = UserFixture.build();
  const post = PostFixture.build({ authorId: user._id });
  user.favoritePostId = post._id;

  await db.collection("users").insertOne(user);
  await db.collection("posts").insertOne(post);

  const storedUser = await db.collection("users").findOne({ _id: user._id });
  const storedPost = await db.collection("posts").findOne({ _id: post._id });

  expect(storedUser?.favoritePostId).toEqual(post._id);
  expect(storedPost?.authorId).toEqual(user._id);
  /* Map fields round-trip as embedded documents on the wire. */
  expect(storedUser?.preferences).toEqual({ theme: "dark" });
});

test("Post embeds an array of discriminated Comment subdocuments", async () => {
  const { db } = mongo;
  const post = PostFixture.build({
    comments: [
      CommentFixture.text({ body: "first" }),
      CommentFixture.image({ imageUrl: "https://example.test/x.png" }),
    ],
  });

  await db.collection("posts_with_comments").insertOne(post);
  const stored = await db.collection("posts_with_comments").findOne({ _id: post._id });

  expect(stored?.comments).toHaveLength(2);
  expect(stored?.comments[0].kind).toBe("text");
  expect(stored?.comments[1].kind).toBe("image");
});

test("all BSON types round-trip without loss", async () => {
  const { db } = mongo;
  const doc = AllBsonTypesFixture.build();
  await db.collection("bson_types").insertOne(doc);
  const stored = await db.collection("bson_types").findOne({ _id: doc._id });

  expect(stored?.stringValue).toBe("typemo");
  expect(stored?.int32Value?.valueOf()).toBe(42);
  expect(stored?.decimal128Value?.toString()).toBe("19.99");
  expect(stored?.dateValue).toEqual(doc.dateValue);
  expect(stored?.nullValue).toBeNull();
  expect(stored?.minKeyValue).toBeDefined();
  expect(stored?.maxKeyValue).toBeDefined();
});
