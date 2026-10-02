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
const plan = Pipeline.database()
  .documents([{ n: 1 }, { n: 2 }])
  .plan();
console.log(plan.target, plan.pipeline);
// → { kind: "database", admin: false } [{ $documents: [{ n: 1 }, { n: 2 }] }]
const rows = await client.aggregate(plan);
//    ^?
console.log(rows);
// → [{ n: 1 }, { n: 2 }]
