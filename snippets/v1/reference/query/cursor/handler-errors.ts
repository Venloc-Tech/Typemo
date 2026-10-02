import { EachAsyncError } from "@venloc/typemo";
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
  @Prop(() => String, { required: true }) status!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Orders = client.db().model(Order);
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
