import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true, unique: true })
  sku!: string;

  @Prop(() => String, { required: true, unique: true })
  name!: string;

  @Prop(() => Number, { required: true, min: 0 })
  price!: number;
}
