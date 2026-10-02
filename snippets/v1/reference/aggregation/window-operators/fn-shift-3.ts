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
      output: (f) => ({ next: fn.shift({ output: f.total, by: 1 }) }),
    })
    .sort({ placedAt: 1 })
    .project((f) => ({ _id: 0, customer: 1, total: 1, next: 1 })),
).plain();
console.log(rows);
// → [
//   { customer: "Alice", total: 120, next: 80 },
//   { customer: "Alice", total: 80, next: null },
//   { customer: "Bob", total: 45, next: 200 },
//   { customer: "Bob", total: 200, next: null },
//   { customer: "Carol", total: 60, next: 95 },
//   { customer: "Carol", total: 95, next: null },
// ]
