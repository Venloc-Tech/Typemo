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
    .redact((f) => fn.cond(fn.eq(f.status, "cancelled"), Vars.PRUNE, Vars.KEEP))
    .sort({ placedAt: 1 })
    .project((f) => ({ _id: 0, customer: 1, status: 1 })),
).plain();
console.log(rows);
// → [
//   { customer: "Alice", status: "paid" },
//   { customer: "Alice", status: "paid" },
//   { customer: "Bob", status: "new" },
//   { customer: "Bob", status: "paid" },
//   { customer: "Carol", status: "paid" },
// ]
