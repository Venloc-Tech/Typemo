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
await Orders.find().sort({ number: 1 }).plain().cursor().eachAsync(
  async (orders, batchIndex) => {
    console.log(batchIndex, orders.map((order) => order.number));
    await __insertMany__(orders);
  },
  { batchSize: 2 },
);
// → 0 [1, 2]
//   1 [3, 4]
//   2 [5]
