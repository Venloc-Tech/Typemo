import { Entity, Prop, Schema, TypemoClient, fn, withWindow } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}

@Schema({ collection: "daily_sales" })
class DailySales extends Entity {
  @Prop(() => Number, { required: true }) day!: number;
  @Prop(() => Number) amount?: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.connection.model(Order);
const Sales = client.connection.model(DailySales);
// ---cut---
const query = Orders.aggregate((p) =>
  p
    .setWindowFields({ sortBy: { placedAt: 1 }, output: (f) => ({ prev: fn.shift({ output: f.total, by: -1 }) }) })
    .project({ total: 1, prev: 1, _id: 0 }),
);
const rows = await query;
//    ^?
// → [{ total: 120, prev: null }, { total: 80, prev: 120 }, { total: 50, prev: 80 }, { total: 30, prev: 50 }, { total: 200, prev: 30 }]
