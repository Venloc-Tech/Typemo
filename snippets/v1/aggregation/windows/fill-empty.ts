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
const filled = await Sales.aggregate((p) =>
  p.fill({ sortBy: { day: 1 }, output: { amount: { method: "locf" } } }).project({ day: 1, amount: 1, _id: 0 }),
);
// → [{ day: 1, amount: 10 }, { day: 2, amount: 10 }, { day: 4, amount: 40 }, { day: 5, amount: 40 }]

const zeros = await Sales.aggregate((p) =>
  p.fill({ output: { amount: { value: () => 0 } } }).project({ day: 1, amount: 1, _id: 0 }),
);
// → [{ day: 1, amount: 10 }, { day: 2, amount: 0 }, { day: 4, amount: 40 }, { day: 5, amount: 0 }]
