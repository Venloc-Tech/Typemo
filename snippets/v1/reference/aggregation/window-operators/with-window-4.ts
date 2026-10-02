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
      output: (f) => ({
        last10: withWindow(fn.sum(f.total), { range: [-10, 0], unit: "day" }),
      }),
    })
    .sort({ placedAt: 1 })
    .project((f) => ({ _id: 0, customer: 1, total: 1, last10: 1 })),
).plain();
console.log(rows);
// → [
//   { customer: "Alice", total: 120, last10: 120 },
//   { customer: "Alice", total: 80, last10: 200 },
//   { customer: "Bob", total: 45, last10: 45 },
//   { customer: "Bob", total: 200, last10: 200 },
//   { customer: "Carol", total: 60, last10: 60 },
//   { customer: "Carol", total: 95, last10: 155 },
// ]
