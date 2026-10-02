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

order.lines[1]!.qty = 9;
order.lines[0]!.sku = "Z";
console.log(order.$getChanges());
// → { $set: { "lines.0.sku": "Z", "lines.1.qty": 9 } }
