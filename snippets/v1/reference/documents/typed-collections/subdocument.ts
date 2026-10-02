import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) street?: string;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Address) address?: Address;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const order = await Orders.create({ customer: "alice", address: { city: "Oslo" } });

order.address!.city = "Rome";
console.log(order.$getChanges());
// → { $set: { "address.city": "Rome" } }
