import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 0 }) qty!: number;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [Line]) lines!: Line[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const order = Orders.new({ customer: "alice", lines: [{ sku: "A1", qty: 2 }] });
const line = order.lines[0]!;
console.log(line.$isNew(), line.$isRoot(), order.$isRoot());
// → true false true

await order.$save();
line.qty = 3;
console.log(line.$isNew(), line.$isModified("qty"), line.$isModified("sku"));
// → false true false
