import { ObjectId } from "mongodb";
import { Entity, Prop, Schema, TypemoClient, Versioned, isUnknownFieldsError, unknownFieldsOf } from "@venloc/typemo";
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
order.lines[0]!.qty = 9;
await order.$save();

order.lines.push({ sku: "C3", qty: 1 });
await order.$save();

const stored = await rawOrders.findOne({ _id: id });
console.log(stored?.address, stored?.lines[0]?.oldPrice);
// → { city: "Rome", legacyZip: "0150" } 5
