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
export const exportSpent = async (write: (line: string) => void) => {
  const query = Orders.aggregate((p) =>
    p.group((f) => ({ _id: f.customer, spent: fn.sum(f.total) })).sort({ _id: 1 }),
  );
  for await (const row of query.batchSize(2).cursor()) {
    write(`${row._id}: ${row.spent}`);
    // → "alice: 200", "bob: 250", "carol: 30"
  }
};
