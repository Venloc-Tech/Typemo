import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
  @Prop(() => String, { required: true }) status!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Orders = client.db().model(Order);
// ---cut---
const numbers = Orders.find().sort({ number: 1 }).plain().cursor().map((order) => order.number * 10);
console.log(await numbers.toArray());
// → [10, 20, 30, 40, 50]
