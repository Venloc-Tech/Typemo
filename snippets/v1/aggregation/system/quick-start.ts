import { Entity, Index, Prop, Schema, TypemoClient, Pipeline } from "@venloc/typemo";

@Schema({ collection: "orders" })
@Index({ status: 1 })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true }) status!: string;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.connection.model(Order);
// ---cut---
const stats = await Orders.aggregate((p) => p.collStats({ count: {} }));
console.log(stats.map((row) => row.count));
// → [2]

const plan = Pipeline.admin().currentOp({ idleConnections: false }).limit(1).plan();
const ops = await client.aggregate(plan);
console.log(ops.length);
// → 1
