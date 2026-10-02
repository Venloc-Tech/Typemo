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
const query = Orders.aggregate((p) => p.collStats({ count: {} }));
const rows = await query;
//    ^?
