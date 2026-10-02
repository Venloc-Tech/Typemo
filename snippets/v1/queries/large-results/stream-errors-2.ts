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
  await Orders.find().sort({ number: 1 }).plain().cursor().eachAsync(
    (order) => {
      if (order.number % 2 === 0) throw new Error(`order ${order.number} rejected`);
    },
    { continueOnError: true },
  );
} catch (error) {
  if (error instanceof EachAsyncError) {
    console.log(error.message);
    // → "eachAsync: 2 call(s) of the callback failed (continueOnError)"
    console.log(error.errors.map(String));
    // → ["Error: order 2 rejected", "Error: order 4 rejected"]
  }
}
