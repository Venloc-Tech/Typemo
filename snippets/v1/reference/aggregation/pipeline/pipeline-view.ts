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
// ---cut---
@Schema({ collection: "paid_orders" })
class PaidOrder extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Number, { required: true }) total!: number;
}

const definition = Pipeline.view(PaidOrder, {
  on: Order,
  pipeline: (p) => p.match({ status: "paid" }).project({ customer: 1, total: 1 }),
});
console.log(definition);
// → { viewOn: "orders", pipeline: [{ $match: { status: "paid" } }, { $project: { customer: 1, total: 1 } }] }
