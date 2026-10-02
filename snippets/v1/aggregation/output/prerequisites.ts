import { Entity, EntityWithId, Prop, Schema } from "@venloc/typemo";

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

@Schema({ collection: "monthly_revenue" })
export class MonthlyRevenue extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true })
  revenue!: number;
}
