import { Entity, Prop, Schema, Spec, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Spec.map(Number)) fees?: Map<string, number>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const order = await Orders.create({ customer: "alice", fees: { delivery: 5, gift: 3 } });

console.log(order.fees?.delete("gift"), order.fees?.delete("missing"));
// → true false
console.log(order.$getChanges());
// → { $unset: { "fees.gift": "" } }
