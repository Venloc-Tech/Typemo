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
    total: (b) => b.count("n"),
    page: (b) => b.sort({ placedAt: "descending" }).limit(2).project({ customer: 1, total: 1, _id: 0 }),
    byStatus: (b) => b.sortByCount((f) => f.status),
  }),
);
const [report] = await query.plain();
//     ^?
// → { total: [{ n: 5 }], page: [{ customer: "carol", total: 30 }, { customer: "bob", total: 200 }],
//     byStatus: [{ _id: "paid", count: 3 }, …] }
