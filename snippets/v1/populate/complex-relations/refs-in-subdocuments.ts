import { Entity, Prop, Schema, Types, type Ref } from "@venloc/typemo";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

@Schema()
export class Attachment {
  @Prop(() => String, { required: true })
  file!: string;

  @Prop(() => Types.ObjectId, { ref: () => User })
  uploader?: Ref<User>;
}

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => [Attachment]) // [!code ++]
  attachments!: Attachment[]; // [!code ++]
}
