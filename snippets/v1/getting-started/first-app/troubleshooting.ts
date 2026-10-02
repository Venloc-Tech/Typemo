// @errors: 1240
import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => Boolean, { default: false })
  published!: boolean;
}
