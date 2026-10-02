import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema()
export class Variant {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true })
  qty!: number;
}

@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { required: true })
  price!: number;

  @Prop(() => Number, { required: true })
  stock!: number;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Date)
  released?: Date;

  @Prop(() => String, { nullable: true })
  note!: string | null;

  @Prop(() => [Variant])
  variants!: Variant[];
}
