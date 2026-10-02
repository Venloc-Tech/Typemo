import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "posts", softDelete: true })
export class Post extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
