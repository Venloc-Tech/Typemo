import { Entity, Prop, Schema, Spec, type Vector } from "@venloc/typemo";

@Schema({ collection: "articles" })
export class Article extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 }))
  embedding?: Vector;
}
