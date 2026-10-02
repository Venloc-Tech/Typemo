import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => Number, { required: true })
  total!: number;

  @Prop(() => Date, { required: true })
  placedAt!: Date;
}

@Schema({ collection: "daily_sales" })
export class DailySales extends Entity {
  @Prop(() => Number, { required: true })
  day!: number;

  @Prop(() => Number)
  amount?: number;
}
