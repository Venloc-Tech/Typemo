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
// resumable export: the id of the last processed order
import type { Filter } from "@venloc/typemo";

export const exportOrders = async (lastId: string | null) => {
  const filter: Filter<Order> = lastId === null ? {} : { _id: { $gt: lastId } };
  let last = lastId;

  // order by _id: "after this document" is unambiguous
  const cursor = Orders.find(filter).sort({ _id: 1 }).plain().cursor();

  try {
    // batches of 100, four batches at a time; errors are collected
    await cursor.eachAsync(
      async (orders) => {
        await __insertMany__(orders);
        last = orders.at(-1)?._id ?? last;
      },
      { batchSize: 100, parallel: 4, continueOnError: true },
    );
  } catch (error) {
    if (error instanceof EachAsyncError) {
      console.log(`${error.errors.length} batches failed`);
    }
    throw error;
  }
  return last;
};
