import { Entity, Index, Prop, Schema } from "@venloc/typemo";

@Index({ views: 1 })
@Schema({ collection: "articles" })
export class Article extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => Number, { required: true })
  views!: number;
}
