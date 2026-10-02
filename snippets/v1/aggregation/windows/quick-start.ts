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
  p.setWindowFields({
    partitionBy: (f) => f.customer,
    sortBy: { placedAt: 1 },
    output: (f) => ({
      running: withWindow(fn.sum(f.total), { documents: ["unbounded", "current"] }),
      rank: fn.rank(),
    }),
  }),
);
const rows = await query;
//    ^?
// → alice: (120, running 120, rank 1), (80, 200, 2), (30, 230, 3); bob: (50, 50, 1), (200, 250, 2)
