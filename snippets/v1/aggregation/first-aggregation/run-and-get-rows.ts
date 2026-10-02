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
export const spentByCustomer = async () => {
  const query = Orders.aggregate((p) =>
    p
      .match({ status: "paid" })
      .group((f) => ({ _id: f.customer, orders: fn.count(), spent: fn.sum(f.total) }))
      .sort({ spent: "descending" }),
  );
  const rows = await query;
  //    ^?
  // → [{ _id: "alice", orders: 2, spent: 200 }, { _id: "bob", orders: 1, spent: 50 }]
  return rows;
};
