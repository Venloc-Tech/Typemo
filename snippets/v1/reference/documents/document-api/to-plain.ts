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
await Orders.create({
  customer: "alice",
  tags: ["gift"],
  lines: [{ sku: "A1", qty: 2 }],
  fees: { delivery: 5 },
  note: "call first",
});
const order = await Orders.findOne({ customer: "alice" }).select({ "+note": true }).orFail();
// ---cut---
const plain = order.$toPlain();
//    ^?
console.log(typeof plain._id, "note" in plain, plain.fees instanceof Map);
// → "string" false true

console.log(order.$toPlain({ hidden: true }).note);
// → "call first"
