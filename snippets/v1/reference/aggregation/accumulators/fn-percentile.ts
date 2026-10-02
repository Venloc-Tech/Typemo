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
    .group((f) => ({
      _id: f.status,
      q: fn.percentile({ input: f.total, p: [0.25, 0.9] }),
    }))
    .sort({ _id: 1 }),
).plain();
console.log(rows);
// → [
//   { _id: "cancelled", q: [60, 60] },
//   { _id: "new", q: [45, 45] },
//   { _id: "paid", q: [80, 200] },
// ]
