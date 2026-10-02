import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => String, { required: true })
  status!: string;

  @Prop(() => Number, { required: true })
  total!: number;

  @Prop(() => Date, { required: true })
  placedAt!: Date;
}
