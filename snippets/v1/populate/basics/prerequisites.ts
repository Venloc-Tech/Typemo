import { Entity, Prop, Schema, Types, type Ref } from "@venloc/typemo";

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
}
