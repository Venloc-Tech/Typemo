import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  price!: number;

  @Prop(() => Number)
  discount?: number;

  @Prop(() => [String], { required: true })
  tags!: string[];
}
