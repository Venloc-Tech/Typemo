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
// 1. Collection size.
export const ordersCount = async () => {
  const [row] = await Orders.aggregate((p) => p.collStats({ count: {} }));
  return Number(row?.count ?? 0);
};

// 2. Collection indexes.
export const indexNames = () =>
  Orders.aggregate((p) => p.indexStats().project({ name: 1, _id: 0 })).plain();

// 3. Server operations.
export const runningOps = () => {
  const plan = Pipeline.admin().currentOp({ idleConnections: false }).limit(10).plan();
  return client.aggregate(plan);
};
