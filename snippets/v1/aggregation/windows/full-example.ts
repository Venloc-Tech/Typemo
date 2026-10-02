import { Entity, Prop, Schema, TypemoClient, fn, withWindow } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}

@Schema({ collection: "daily_sales" })
class DailySales extends Entity {
  @Prop(() => Number, { required: true }) day!: number;
  @Prop(() => Number) amount?: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.connection.model(Order);
const Sales = client.connection.model(DailySales);
// ---cut---
export const orderTimeline = () =>
  Orders.aggregate((p) =>
    p
      .setWindowFields({
        partitionBy: (f) => f.customer,
        sortBy: { placedAt: 1 },
        output: (f) => ({
          running: withWindow(fn.sum(f.total), { documents: ["unbounded", "current"] }),
          rank: fn.rank(),
          previous: fn.shift({ output: f.total, by: -1 }),
        }),
      })
      .project({ customer: 1, total: 1, running: 1, rank: 1, previous: 1, _id: 0 }),
  ).plain();

export const continuousSales = () =>
  Sales.aggregate((p) =>
    p
      .densify({ field: "day", range: { step: 1, bounds: "full" } })
      .fill({ sortBy: { day: 1 }, output: { amount: { method: "locf" } } })
      .project({ day: 1, amount: 1, _id: 0 }),
  );
