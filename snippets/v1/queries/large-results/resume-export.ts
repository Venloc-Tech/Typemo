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
import type { Filter } from "@venloc/typemo";

export const exportOrdersAfter = async (lastId: string | null) => {
  const filter: Filter<Order> = lastId === null ? {} : { _id: { $gt: lastId } };
  let last = lastId;

  for await (const order of Orders.find(filter).sort({ _id: 1 }).plain().cursor()) {
    await __sendToWarehouse__(order);
    last = order._id; // store this value where it survives a restart
  }
  return last;
};
