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
    .sort({ placedAt: 1 })
    .group((f) => ({
      _id: f.customer,
      discounts: fn.firstN({ input: f.discount, n: 2 }),
    }))
    .sort({ _id: 1 }),
).plain();
console.log(rows);
// → [
//   { _id: "Alice", discounts: [10, null] },
//   { _id: "Bob", discounts: [5, null] },
//   { _id: "Carol", discounts: [null, 15] },
// ]
