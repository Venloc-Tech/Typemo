// @filename: user.model.ts
import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true, trim: true })
  name!: string;

  @Prop(() => String, { required: true, unique: true, lowercase: true })
  email!: string;

  @Prop(() => String, { hidden: true })
  passwordHash?: Hidden<string>;
}
// @filename: post.model.ts
import { type Defaulted, Entity, Prop, type Ref, Schema, Timestamped, Types, Virtual, type VirtualRef } from "@venloc/typemo";
import { Comment } from "./comment.model.ts";
import { User } from "./user.model.ts";

@Schema({ collection: "posts" })
export class Post extends Timestamped(Entity) {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Boolean, { default: false })
  published!: Defaulted<boolean>;

  @Prop(() => Types.ObjectId, { ref: () => User, required: true })
  author!: Ref<User>;

  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post" })
  comments?: VirtualRef<Comment>;
}
// @filename: comment.model.ts
import { Entity, Prop, type Ref, Schema, Types } from "@venloc/typemo";
import { Post } from "./post.model.ts";
import { User } from "./user.model.ts";

@Schema({ collection: "comments" })
export class Comment extends Entity {
  @Prop(() => String, { required: true })
  text!: string;

  @Prop(() => Types.ObjectId, { ref: () => Post, required: true })
  post!: Ref<Post>;

  @Prop(() => Types.ObjectId, { ref: () => User, required: true })
  author!: Ref<User>;
}
// @filename: db.ts
import { TypemoClient } from "@venloc/typemo";
import { Comment } from "./comment.model.ts";
import { Post } from "./post.model.ts";
import { User } from "./user.model.ts";

export const client = await TypemoClient.connect("mongodb://localhost:27017/blog");

export const Users = client.connection.model(User);
export const Posts = client.connection.model(Post);
export const Comments = client.connection.model(Comment);

await client.connection.init();
// @filename: users.service.ts
import { DuplicateKeyError } from "@venloc/typemo";
import { Users } from "./db.ts";

// your code: the error at the application boundary and password hashing
export class __Conflict__ extends Error {}
const __hashPassword__ = (password: string): string => `hash:${password}`;

export const registerUser = async (name: string, email: string, password: string) => {
  try {
    const user = await Users.create({ name, email, passwordHash: __hashPassword__(password) });
    return user.$toPlain();
  } catch (error) {
    if (error instanceof DuplicateKeyError) throw new __Conflict__(`email ${email} is taken`);
    throw error;
  }
};
// @filename: posts.service.ts
import { Posts } from "./db.ts";

export const writePost = (authorId: string, title: string, body: string, tags: string[] = []) =>
  Posts.create({ author: authorId, title, body, tags });

export const publishPost = (id: string) => Posts.updateOne({ _id: id }, { $set: { published: true } });

export const addTag = (id: string, tag: string) => Posts.updateOne({ _id: id }, { $addToSet: { tags: tag } });

export const listPublished = (page: number, pageSize = 10) =>
  Posts.find({ published: true })
    .sort({ createdAt: -1, _id: 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .select({ title: 1, tags: 1, author: 1, createdAt: 1 })
    .populate({ path: "author", select: { name: 1 }, required: true })
    .plain();

export const readPost = (id: string) =>
  Posts.findById(id)
    .populate([
      { path: "author", required: true },
      { path: "comments", populate: { path: "author", select: { name: 1 }, required: true } },
    ])
    .orFail()
    .plain();
// @filename: comments.service.ts
import { Comments } from "./db.ts";

export const addComment = (postId: string, authorId: string, text: string) =>
  Comments.create({ post: postId, author: authorId, text });

export const removeComment = async (id: string) => {
  const result = await Comments.deleteOne({ _id: id });
  return result.deletedCount === 1;
};
// @filename: main.ts
// ---cut---
import { addComment, removeComment } from "./comments.service.ts";
import { client } from "./db.ts";
import { addTag, listPublished, publishPost, readPost, writePost } from "./posts.service.ts";
import { __Conflict__, registerUser } from "./users.service.ts";

const alice = await registerUser("Alice", "alice@example.com", "s3cret");
const bob = await registerUser("Bob", "bob@example.com", "pa55word");

try {
  await registerUser("Alice again", "Alice@Example.com", "other");
} catch (error) {
  console.log(error instanceof __Conflict__, (error as Error).message);
  // → true email Alice@Example.com is taken
}

const post = await writePost(alice._id, "Hello", "My first post", ["intro"]);
await writePost(alice._id, "Draft", "Not ready yet");

console.log((await listPublished(1)).length);
// → 0

await publishPost(post._id.toString());
await addTag(post._id.toString(), "typemo");
console.log((await listPublished(1)).map((item) => `${item.title} by ${item.author.name}`));
// → ["Hello by Alice"]

const firstComment = await addComment(post._id.toString(), bob._id, "Nice!");
await addComment(post._id.toString(), alice._id, "Thanks");

const page = await readPost(post._id.toString());
console.log(page.comments.map((comment) => `${comment.author.name}: ${comment.text}`));
// → ["Bob: Nice!", "Alice: Thanks"]

console.log(await removeComment(firstComment._id.toString()));
// → true

await client.close();
