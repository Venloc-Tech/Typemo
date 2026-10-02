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
// 1. Report: customers who paid, from the most generous.
export const spendingReport = Pipeline.from(Order)
  .match({ status: "paid" })
  .group((f) => ({ _id: f.customer, orders: fn.count(), spent: fn.sum(f.total) }))
  .sort({ spent: "descending" })
  .plan();

// 2. For an API: rows as JSON.
export const spendingForApi = () => Orders.aggregate(spendingReport).plain();

// 3. For an export: one row at a time.
export const streamSpending = () => Orders.aggregate(spendingReport).batchSize(100).cursor();
