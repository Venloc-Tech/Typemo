import { Entity, EntityWithId, Prop, Schema, TypemoClient, fn } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}

@Schema({ collection: "monthly_revenue" })
class MonthlyRevenue extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) revenue!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.connection.model(Order);
const Monthly = client.connection.model(MonthlyRevenue);
// ---cut---
await Orders.aggregate((p) =>
  p
    .group((f) => ({ _id: fn.dateToString({ date: f.placedAt, format: "%Y-%m" }), revenue: fn.sum(f.total) }))
    .merge({ into: MonthlyRevenue, whenMatched: "replace" }),
);
console.log(await Monthly.find().sort({ _id: 1 }).lean());
// → [{ _id: "2026-01", revenue: 120 }, { _id: "2026-02", revenue: 155 }, { _id: "2026-04", revenue: 10 }]
