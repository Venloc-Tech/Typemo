import { ObjectId } from "mongodb";
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
const order = await Orders.create({ customer: "alice", lines: [{ sku: "A1", qty: 2 }, { sku: "B2", qty: 1 }] });
const id = order.lines[0]!._id;

console.log(order.lines.id(id)?.sku, order.lines.id(String(id))?.sku, order.lines.id(new ObjectId())?.sku);
// → "A1" "A1" undefined
