// @errors: 2769
import { Entity, EntityWithId, Prop, Schema, TypemoClient, fn } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
}

@Schema({ collection: "monthly_revenue" })
class MonthlyRevenue extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) revenue!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.connection.model(Order);
// ---cut---
await Orders.aggregate((p) => p.group((f) => ({ _id: f.status, total: fn.sum(f.total) })).out(MonthlyRevenue));
