import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  views!: number;

  @Prop(() => Number)
  rating?: number;

  @Prop(() => String, { nullable: true })
  topic!: string | null;
}
