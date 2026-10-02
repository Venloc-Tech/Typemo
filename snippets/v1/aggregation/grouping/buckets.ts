import { Entity, Prop, Schema, TypemoClient, fn, Pipeline, type RowOf } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.connection.model(Order);
// ---cut---
const query = Orders.aggregate((p) =>
  p.bucket({
    groupBy: (f) => f.total,
    boundaries: [0, 50, 100, 500],
    default: "other",
    output: (f) => ({ orders: fn.count(), sum: fn.sum(f.total) }),
  }),
);
const rows = await query;
//    ^?
// → [{ _id: 0, orders: 1, sum: 30 }, { _id: 50, orders: 2, sum: 130 }, { _id: 100, orders: 2, sum: 320 }]
