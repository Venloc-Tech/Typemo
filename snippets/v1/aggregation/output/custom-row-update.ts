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
const increment = Orders.aggregate((p) =>
  p
    .match({ status: "paid" })
    .group((f) => ({ _id: fn.dateToString({ date: f.placedAt, format: "%Y-%m" }), revenue: fn.sum(f.total) }))
    .merge({
      into: MonthlyRevenue,
      on: "_id",
      whenMatched: (u, v) => u.set((f) => ({ revenue: fn.add(f.revenue, v.new.revenue) })),
    }),
);
