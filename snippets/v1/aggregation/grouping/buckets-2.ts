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
const rows = await Orders.aggregate((p) =>
  p.bucketAuto({ groupBy: (f) => f.total, buckets: 2, output: () => ({ orders: fn.count() }) }),
);
// → [{ _id: { min: 30, max: 120 }, orders: 3 }, { _id: { min: 120, max: 200 }, orders: 2 }]
