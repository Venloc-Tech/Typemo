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
      _id: fn.dateToString({ date: f.placedAt, format: "%Y-%m" }),
      revenue: fn.sum(f.total),
    }))
    .sort({ _id: 1 }),
);
const rows = await query;
//    ^?
// → [{ _id: "2026-01", revenue: 120 }, { _id: "2026-02", revenue: 130 }, { _id: "2026-03", revenue: 230 }]
