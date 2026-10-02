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
await Orders.find().sort({ number: 1 }).plain().cursor().eachAsync(async (order, index) => {
  await __sendToWarehouse__(order);
  console.log(index, order.number);
});
// → 0 1
//   1 2
//   2 3
//   3 4
//   4 5
