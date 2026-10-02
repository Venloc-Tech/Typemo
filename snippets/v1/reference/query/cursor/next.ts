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

const first = await cursor.next();
const second = await cursor.next();
console.log(first?.number, second?.number);
// → 1 2
