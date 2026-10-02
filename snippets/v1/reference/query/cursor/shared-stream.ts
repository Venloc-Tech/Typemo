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
const mapped = cursor.map((order) => order.number);

const viaMapped = await mapped.next();
const viaOriginal = await cursor.next();
console.log(viaMapped, viaOriginal?.number);
// → 1 2
