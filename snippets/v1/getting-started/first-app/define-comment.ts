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
// ---cut---
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
