import { Entity, type Hidden, Prop, Schema, Spec, TypemoClient, Versioned } from "@venloc/typemo";
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) street?: string;
}
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 0 }) qty!: number;
}
@Schema({ collection: "orders" })
class Order extends Versioned(Entity) {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => Address) address?: Address;
  @Prop(() => Spec.map(Number)) fees?: Map<string, number>;
  @Prop(() => String, { hidden: true }) note?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
const order = await Orders.create({
  customer: "alice",
  tags: ["gift"],
  lines: [{ sku: "A1", qty: 2 }],
  address: { city: "Oslo" },
  fees: { delivery: 5 },
});
console.log(order.$getChanges());
// → {}

order.customer = "bob";
order.tags.push("express");
order.lines[0]!.qty = 5;
order.fees?.set("gift", 3);
console.log(order.$getChanges());
// → { $set: { customer: "bob", "lines.0.qty": 5, "fees.gift": 3 }, $push: { tags: { $each: ["express"] } } }
