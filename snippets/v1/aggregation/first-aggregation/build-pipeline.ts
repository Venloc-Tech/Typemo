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
const all = Pipeline.from(Order);
type AllRow = RowOf<typeof all>;
//   ^?

const paid = all.match({ status: "paid" });
type PaidRow = RowOf<typeof paid>;
//   ^?

const perCustomer = paid.group((f) => ({
  _id: f.customer,
  orders: fn.count(),
  spent: fn.sum(f.total),
}));
type CustomerRow = RowOf<typeof perCustomer>;
//   ^?
