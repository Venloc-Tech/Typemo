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
  p
    .group((f) => ({
      _id: f.customer,
      orders: fn.count(),
      spent: fn.sum(f.total),
      average: fn.avg(f.total),
      biggest: fn.max(f.total),
    }))
    .sort({ _id: 1 }),
);
const rows = await query;
//    ^?
// → [{ _id: "alice", orders: 2, spent: 200, average: 100, biggest: 120 }, { _id: "bob", orders: 2, spent: 250, average: 125, biggest: 200 }, …]
