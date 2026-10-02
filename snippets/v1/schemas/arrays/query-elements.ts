import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 1 }) qty!: number;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Line]) lines!: Line[];
}
const Orders = client.connection.model(Order);
await Orders.create({ customer: "bob", tags: [], lines: [{ sku: "B", qty: 2 }] });
// ---cut---
const found = await Orders.find({ "lines.sku": "B" }).plain();
console.log(found.length);
// → 1
await Orders.updateOne({ customer: "bob" }, { $push: { tags: "vip" } });
console.log((await Orders.findOne({ customer: "bob" }).plain())?.tags);
// → ["vip"]
try {
  await Orders.updateOne({ customer: "bob" }, { $push: { lines: { sku: "Z", qty: 0 } } } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "lines.+0.qty": must be at least 1 [min]
