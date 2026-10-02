import { Entity, Prop, Schema, TypemoClient, fn, Vars, withWindow } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => String, { required: true, enum: ["new", "paid", "cancelled"] })
  status!: "new" | "paid" | "cancelled";

  @Prop(() => Number, { required: true })
  total!: number;

  @Prop(() => Number)
  discount?: number;

  @Prop(() => [Number])
  prices!: number[];

  @Prop(() => Date, { required: true })
  placedAt!: Date;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const rows = await Orders.aggregate((p) =>
  p
    .setWindowFields({
      partitionBy: (f) => f.customer,
      sortBy: { placedAt: 1 },
      output: (f) => ({ ema: fn.expMovingAvg({ input: f.total, N: 2 }) }),
    })
    .sort({ placedAt: 1 })
    .project((f) => ({ _id: 0, customer: 1, total: 1, ema: 1 })),
).plain();
console.log(rows);
// → [
//   { customer: "Alice", total: 120, ema: 120 },
//   { customer: "Alice", total: 80, ema: 93.33333333333333 },
//   { customer: "Bob", total: 45, ema: 45 },
//   { customer: "Bob", total: 200, ema: 148.33333333333334 },
//   { customer: "Carol", total: 60, ema: 60 },
//   { customer: "Carol", total: 95, ema: 83.33333333333333 },
// ]
