import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 1 }) qty!: number;
}

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => [Line])
  lines!: Line[];
}

const Orders = client.connection.model(Order);
const order = await Orders.create({
  customer: "ann",
  tags: ["gift"],
  lines: [{ sku: "A1", qty: 2 }],
});
console.log(order.$toPlain().lines.length, order.tags.length);
// → 1 1
