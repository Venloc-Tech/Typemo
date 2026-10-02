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
      output: (f) => ({
        scaled: withWindow(fn.minMaxScaler({ input: f.total }), {
          documents: ["unbounded", "unbounded"],
        }),
      }),
    })
    .sort({ placedAt: 1 })
    .project((f) => ({ _id: 0, total: 1, scaled: 1 })),
).plain();
console.log(rows);
// → [
//   { total: 120, scaled: 0.4838709677419355 },
//   { total: 80, scaled: 0.22580645161290322 },
//   { total: 45, scaled: 0 },
//   { total: 200, scaled: 1 },
//   { total: 60, scaled: 0.0967741935483871 },
//   { total: 95, scaled: 0.3225806451612903 },
// ]
