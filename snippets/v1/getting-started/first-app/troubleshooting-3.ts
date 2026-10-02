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
// @filename: posts.controller.ts
// ---cut---
import { CastError, DocumentNotFoundError } from "@venloc/typemo";
import { readPost } from "./posts.service.ts";

// your code: the error at the application boundary
class __NotFound__ extends Error {}

export const showPost = async (idFromUrl: string) => {
  try {
    return await readPost(idFromUrl);
  } catch (error) {
    if (error instanceof CastError || error instanceof DocumentNotFoundError) throw new __NotFound__("post not found");
    throw error;
  }
};
