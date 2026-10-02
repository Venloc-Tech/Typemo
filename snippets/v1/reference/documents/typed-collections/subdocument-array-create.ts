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
const order = await Orders.create({ customer: "alice", lines: [{ sku: "A1", qty: 2 }] });

const line = order.lines.create({ sku: "C3", qty: 1 });
console.log(order.lines.length, line.$parent());
// → 1 undefined

order.lines.push(line);
console.log(order.lines.length, order.$getChanges().$push !== undefined);
// → 2 true
