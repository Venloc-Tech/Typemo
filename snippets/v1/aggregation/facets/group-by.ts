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
const query = Orders.aggregate((p) =>
  p.facet({
    byStatus: (b) => b.sortByCount((f) => f.status),
    bySize: (b) =>
      b.bucket({ groupBy: (f) => f.total, boundaries: [0, 100, 500], output: () => ({ orders: fn.count() }) }),
  }),
);
const [report] = await query;
//     ^?
