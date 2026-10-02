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
        area: withWindow(fn.integral({ input: f.total, unit: "day" }), {
          documents: ["unbounded", "current"],
        }),
      }),
    })
    .sort({ placedAt: 1 })
    .project((f) => ({ _id: 0, customer: 1, total: 1, area: 1 })),
).plain();
console.log(rows);
// → [
//   { customer: "Alice", total: 120, area: 0 },
//   { customer: "Alice", total: 80, area: 700 },
//   { customer: "Bob", total: 45, area: 0 },
//   { customer: "Bob", total: 200, area: 1715 },
//   { customer: "Carol", total: 60, area: 0 },
//   { customer: "Carol", total: 95, area: 542.5 },
// ]
