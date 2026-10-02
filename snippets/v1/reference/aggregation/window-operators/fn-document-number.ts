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
      sortBy: { customer: 1 },
      output: (f) => ({ place: fn.documentNumber() }),
    })
    .sort({ placedAt: 1 })
    .project((f) => ({ _id: 0, customer: 1, total: 1, place: 1 })),
).plain();
console.log(rows);
// → [
//   { customer: "Alice", total: 120, place: 1 },
//   { customer: "Alice", total: 80, place: 2 },
//   { customer: "Bob", total: 45, place: 3 },
//   { customer: "Bob", total: 200, place: 4 },
//   { customer: "Carol", total: 60, place: 5 },
//   { customer: "Carol", total: 95, place: 6 },
// ]
