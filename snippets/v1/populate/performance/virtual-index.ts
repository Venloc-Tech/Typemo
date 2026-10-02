import { Entity, Prop, Schema, Types, type Ref } from "@venloc/typemo";

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

@Schema({ collection: "comments" })
export class Comment extends Entity {
  @Prop(() => String, { required: true })
  text!: string;

  @Prop(() => Types.ObjectId, { ref: () => Post, required: true, index: true }) // [!code highlight]
  post!: Ref<Post>;
}
