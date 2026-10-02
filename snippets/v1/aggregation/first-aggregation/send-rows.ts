import { Entity, Prop, Schema, TypemoClient, fn, Pipeline, type RowOf } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.connection.model(Order);
// ---cut---
export const firstPaidOrder = async () => {
  const query = Orders.aggregate((p) => p.match({ status: "paid" }).limit(1)).plain();
  const rows = await query;
  //    ^?
  // → [{ _id: "6abd2bee…", customer: "alice", status: "paid", total: 120, placedAt: 2026-01-05T00:00:00.000Z }]
  return rows;
};
