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
      total: fn.sum(f.discount),
      average: fn.avg(f.discount),
      first: fn.first(f.discount),
      largest: fn.max(f.discount),
    }))
    .sort({ _id: 1 }),
).plain();
console.log(rows);
// → [
//   { _id: "cancelled", total: 0, average: null, first: null, largest: null },
//   { _id: "new", total: 5, average: 5, first: 5, largest: 5 },
//   { _id: "paid", total: 25, average: 12.5, first: 10, largest: 15 },
// ]
