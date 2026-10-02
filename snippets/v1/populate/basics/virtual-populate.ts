import { Entity, Prop, Schema, Types, Virtual, type Ref, type VirtualRef } from "@venloc/typemo";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String)
  email?: string;
}

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Types.ObjectId, { ref: () => User, required: true })
  author!: Ref<User>;

  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post" }) // [!code ++]
  comments?: VirtualRef<Comment>; // [!code ++]
}

@Schema({ collection: "comments" })
export class Comment extends Entity {
  @Prop(() => String, { required: true })
  text!: string;

  @Prop(() => Types.ObjectId, { ref: () => Post, required: true })
  post!: Ref<Post>;
}
