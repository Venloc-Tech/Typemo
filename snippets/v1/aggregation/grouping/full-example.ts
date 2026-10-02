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
// 1. Summary per customer of paid orders.
export const spendingByCustomer = () =>
  Orders.aggregate((p) =>
    p
      .match({ status: "paid" })
      .group((f) => ({ _id: f.customer, orders: fn.count(), spent: fn.sum(f.total) }))
      .sort({ spent: "descending" }),
  ).plain();

// 2. Revenue per month.
export const revenueByMonth = () =>
  Orders.aggregate((p) =>
    p
      .group((f) => ({
        _id: fn.dateToString({ date: f.placedAt, format: "%Y-%m" }),
        revenue: fn.sum(f.total),
      }))
      .sort({ _id: 1 }),
  ).plain();

// 3. Orders bucketed by amount ranges.
export const ordersBySize = () =>
  Orders.aggregate((p) =>
    p.bucket({
      groupBy: (f) => f.total,
      boundaries: [0, 50, 100, 500],
      default: "other",
      output: () => ({ orders: fn.count() }),
    }),
  ).plain();
