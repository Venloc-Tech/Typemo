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
        slope: withWindow(fn.derivative({ input: f.total, unit: "day" }), {
          documents: [-1, 0],
        }),
      }),
    })
    .sort({ placedAt: 1 })
    .project((f) => ({ _id: 0, customer: 1, total: 1, slope: 1 })),
).plain();
console.log(rows);
// → [
//   { customer: "Alice", total: 120, slope: null },
//   { customer: "Alice", total: 80, slope: -5.714285714285714 },
//   { customer: "Bob", total: 45, slope: null },
//   { customer: "Bob", total: 200, slope: 11.071428571428573 },
//   { customer: "Carol", total: 60, slope: null },
//   { customer: "Carol", total: 95, slope: 5 },
// ]
