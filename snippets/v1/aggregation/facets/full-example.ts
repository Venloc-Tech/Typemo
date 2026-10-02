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
export const ordersOverview = async (status: string, page: number) => {
  const query = Orders.aggregate((p) =>
    p.match({ status }).facet({
      count: (b) => b.count("n"),
      rows: (b) =>
        b
          .sort({ placedAt: "descending" })
          .skip((page - 1) * 20)
          .limit(20)
          .project({ customer: 1, total: 1, _id: 0 }),
      bySize: (b) =>
        b.bucket({ groupBy: (f) => f.total, boundaries: [0, 100, 500], default: "other" }),
    }),
  );
  const [report] = await query.plain();
  return {
    total: report?.count[0]?.n ?? 0,
    rows: report?.rows ?? [],
    bySize: report?.bySize ?? [],
  };
};
