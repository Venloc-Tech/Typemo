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
const query = Sales.aggregate((p) => p.densify({ field: "day", range: { step: 1, bounds: "full" } }));
const rows = await query;
//    ^?
// → [{ day: 1, amount: 10 }, { day: 2 }, { day: 3 }, { day: 4, amount: 40 }, { day: 5 }]
