// @filename: user.model.ts
import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true, trim: true })
  name!: string;

  @Prop(() => String, { required: true, unique: true, lowercase: true })
  email!: string;
}
// @filename: post.model.ts
// ---cut---
import { type Defaulted, Entity, Prop, type Ref, Schema, Timestamped, Types } from "@venloc/typemo";
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
}
