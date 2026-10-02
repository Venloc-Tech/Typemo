import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [String]) tags!: string[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const order = await Orders.create({ customer: "alice", tags: ["a", "b", "c"] });

order.tags.replace(["x", "y"]);
console.log(order.$getChanges());
// → { $set: { tags: ["x", "y"] } }
