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
      totals: fn.push(f.total),
      best: fn.top({ output: f.total, sortBy: [[f.total, -1]] }),
    }))
    .sort({ _id: 1 }),
);
const rows = await query;
//    ^?
// → [{ _id: "alice", totals: [120, 80], best: 120 }, { _id: "bob", totals: [50, 200], best: 200 }, …]
