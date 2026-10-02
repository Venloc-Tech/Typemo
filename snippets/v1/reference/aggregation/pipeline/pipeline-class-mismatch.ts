// @errors: 2741 2741 2741
import { Entity, type Hidden, fn, Index, Pipeline, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "orders" })
@Index({ status: 1 })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => BigInt) points?: bigint;
  @Prop(() => String, { hidden: true }) internalNote?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
@Schema({ collection: "paid_orders" })
class PaidOrder extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Number, { required: true }) total!: number;
}
// ---cut---
Pipeline.view(PaidOrder, { on: Order, pipeline: (p) => p.project({ customer: 1, total: 1, _id: 0 }) });
Pipeline.view(PaidOrder, { on: Order, pipeline: (p) => p.project({ customer: 1 }) });
Pipeline.view(PaidOrder, { on: Order, pipeline: (p) => p.project((f) => ({ customer: 1, total: fn.toString_(f.total) })) });
