import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [String]) // [!code highlight]
  tags!: string[];
}
const Orders = client.connection.model(Order);
const order = await Orders.create({ customer: "ann" });
console.log(order.tags.length);
// → 0
const plain = await Orders.findById(order._id).orFail().lean();
console.log(plain.tags);
// → []
