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
for await (const order of cursor) {
  if (order.number === 2) break;
}
await cursor.next(); // [!code error]
// QueryError: the cursor is closed (close() or a left for-await); open a new one
