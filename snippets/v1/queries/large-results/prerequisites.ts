import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => Number, { required: true })
  number!: number;

  @Prop(() => String, { required: true })
  status!: string;
}
