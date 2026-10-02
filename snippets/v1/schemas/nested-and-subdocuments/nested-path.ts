import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Address) shipTo?: Address;
}
const Orders = client.connection.model(Order);
await Orders.create({ customer: "ann", shipTo: { city: "Oslo" } });
// ---cut---
await Orders.updateOne({ customer: "ann" }, { $set: { "shipTo.city": "Rome" } });
const rows = await Orders.find({ "shipTo.city": "Rome" }).plain();
console.log(rows.length);
// → 1
try {
  await Orders.updateOne({ customer: "ann" }, { $set: { "shipTo.city": 5 } } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string failed at path "$set.shipTo.city" for 5 (number): expected a string [type]
