import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}
