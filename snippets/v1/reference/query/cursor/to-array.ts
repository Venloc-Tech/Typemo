import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
  @Prop(() => String, { required: true }) status!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Orders = client.db().model(Order);
// ---cut---
const cursor = Orders.find().sort({ number: 1 }).plain().cursor();
await cursor.next();

const rest = await cursor.toArray();
console.log(rest.map((order) => order.number));
// → [2, 3, 4, 5]
