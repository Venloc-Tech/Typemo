import { Entity, Prop, Schema, Spec, Types, Virtual, type Ref, type VirtualRef } from "@venloc/typemo";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String)
  email?: string;

  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" })
  posts?: VirtualRef<Post>;
}

@Schema({ collection: "tags" })
export class Tag extends Entity {
  @Prop(() => String, { required: true })
  label!: string;
}

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  views!: number;

  @Prop(() => Types.ObjectId, { ref: () => User, required: true })
  author!: Ref<User>;

  @Prop(() => Types.ObjectId, { ref: () => User })
  editor?: Ref<User>;

  @Prop(() => [Types.ObjectId], { ref: () => Tag })
  tags!: Ref<Tag>[];

  @Prop(() => Spec.map(Types.ObjectId), { ref: () => User })
  reviewers?: Map<string, Ref<User>>;

  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post" })
  comments?: VirtualRef<Comment>;

  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post", count: true })
  commentCount?: VirtualRef<Comment, false, true>;
}

@Schema({ collection: "comments" })
export class Comment extends Entity {
  @Prop(() => String, { required: true })
  text!: string;

  @Prop(() => Types.ObjectId, { ref: () => Post, required: true })
  post!: Ref<Post>;

  @Prop(() => Types.ObjectId, { ref: () => User, required: true })
  author!: Ref<User>;
}
