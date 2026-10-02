import { Entity, Index, Prop, Schema, TypemoClient, fn, Vars, withWindow } from "@venloc/typemo";

@Index({ note: "text" })
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

  @Prop(() => String)
  note?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const rows = await Orders.aggregate((p) =>
  p
    .sort({ placedAt: 1 })
    .limit(2)
    .project((f) => ({ _id: 0, total: 1, x: fn.bitAnd(f.total, 12n) })),
).plain();
console.log(rows);
// → [
//   { total: 120, x: "8" },
//   { total: 80, x: "0" },
// ]
