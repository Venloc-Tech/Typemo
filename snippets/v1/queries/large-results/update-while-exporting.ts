import { EachAsyncError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
  @Prop(() => String, { required: true }) status!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.db().model(Order);
declare const __sendToWarehouse__: (order: { number: number }) => Promise<void>;
declare const __insertMany__: (orders: { number: number }[]) => Promise<void>;
// ---cut---
let sent = 0;
for await (const order of Orders.find({ status: "new" }).sort({ number: 1 }).cursor()) {
  order.status = "sent";
  await order.$save();
  sent++;
}
console.log(sent);
// → 2
