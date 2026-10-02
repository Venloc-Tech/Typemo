import { Entity, Prop, Schema, TypemoClient, fn, Vars, withWindow } from "@venloc/typemo";

@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true })
  city!: string;

  @Prop(() => String)
  zip?: string;
}

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

  @Prop(() => Address)
  shipTo?: Address;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const rows = await Orders.aggregate((p) =>
  p
    .group((f) => ({ _id: f.customer, shipTo: fn.mergeObjects(f.shipTo) }))
    .sort({ _id: 1 }),
).plain();
console.log(rows);
// → [
//   { _id: "Alice", shipTo: { city: "Oslo", zip: "0150" } },
//   { _id: "Bob", shipTo: { city: "Rome", zip: "00100" } },
//   { _id: "Carol", shipTo: { city: "Turin" } },
// ]
