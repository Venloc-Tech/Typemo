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
try {
  await Orders.find().sort({ number: 1 }).plain().cursor().eachAsync((order) => {
    if (order.number === 3) throw new Error("order 3 rejected");
  });
} catch (error) {
  console.log(String(error));
  // → "Error: order 3 rejected"
}
