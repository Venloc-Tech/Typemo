import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
  @Prop(() => String, { required: true }) status!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Orders = client.db().model(Order);
declare const __sendToWarehouse__: (order: { number: number }) => Promise<void>;
// ---cut---
for await (const order of Orders.find().sort({ number: 1 }).plain().cursor()) {
  await __sendToWarehouse__(order);
}
