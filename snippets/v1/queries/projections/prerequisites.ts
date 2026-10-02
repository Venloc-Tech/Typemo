import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema()
export class Comment {
  @Prop(() => String, { required: true })
  author!: string;

  @Prop(() => String, { required: true })
  text!: string;

  @Prop(() => Number, { required: true })
  likes!: number;
}

@Schema({ collection: "articles" })
export class Article extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => Number, { required: true })
  views!: number;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => [Comment])
  comments!: Comment[];

  @Prop(() => String, { hidden: true })
  editorNote?: Hidden<string>;
}
