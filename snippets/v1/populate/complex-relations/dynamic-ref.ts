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
}

@Schema({ collection: "activities" })
export class Activity extends Entity {
  @Prop(() => String, { required: true, enum: ["Post", "Comment"] })
  kind!: "Post" | "Comment";

  @Prop(() => Types.ObjectId, { refPath: "kind", required: true })
  target!: Ref<Post | Comment>;
}
