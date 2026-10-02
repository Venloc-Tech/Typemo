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
      sortBy: { placedAt: 1 },
      output: (f) => ({ filled: fn.locf(f.discount) }),
    })
    .sort({ placedAt: 1 })
    .project((f) => ({ _id: 0, discount: 1, filled: 1 })),
).plain();
console.log(rows);
// → [
//   { discount: 10, filled: 10 },
//   { filled: 10 },
//   { discount: 5, filled: 5 },
//   { filled: 5 },
//   { filled: 5 },
//   { discount: 15, filled: 15 },
// ]
