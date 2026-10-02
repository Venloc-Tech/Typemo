import { Entity, type Ref, Prop, Schema, TypemoClient, Types } from "@venloc/typemo";
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "shipments" })
class Shipment extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => Customer }) customer!: Ref<Customer>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Shipments = client.db().model(Shipment);
const shipment = await Shipments.findOne({ title: "T" }).orFail();
// ---cut---
const withCustomer = await shipment.$populate("customer");
console.log(withCustomer.customer?.name);
// → "Ann"
console.log(Object.is(withCustomer, shipment));
// → true
