import { ObjectId } from "mongodb";
import { Entity, Prop, Schema, Spec, TypemoClient, Versioned, isUnknownFieldsError, unknownFieldsOf } from "@venloc/typemo";
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
}
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 0 }) qty!: number;
}
@Schema({ collection: "orders" })
class Order extends Versioned(Entity) {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => Address) address?: Address;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
const rawOrders = client.unsafeDriver().db("shop").collection("orders");
const id = new ObjectId();
await rawOrders.insertOne({
  _id: id,
  customer: "legacy",
  lines: [{ _id: new ObjectId(), sku: "A1", qty: 1, oldPrice: 5 }, { _id: new ObjectId(), sku: "B2", qty: 2 }],
  address: { city: "Oslo", legacyZip: "0150" },
  __v: 0,
});
const order = await Orders.findById(id).orFail();
// ---cut---
order.address!.city = "Rome";
order.lines.push({ sku: "C3", qty: 1 });
await order.$save();
console.log(unknownFieldsOf(order).length);
// → 2

order.lines.reverse();
try {
  await order.$save();
} catch (error) {
  if (isUnknownFieldsError(error)) {
    console.log(error.fields);
    // → [{ path: "lines.2", keys: ["oldPrice"] }]
  }
}
