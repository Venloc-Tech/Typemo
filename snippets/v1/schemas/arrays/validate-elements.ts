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
// ---cut---
try {
  await Orders.create({ customer: "ann", tags: ["a", 5 as never], lines: [] });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string failed at path "tags.1" for 5 (number): expected a string [type]
try {
  await Orders.create({ customer: "ann", tags: "a" as never, lines: [] });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Array<string> failed at path "tags" for "a" (string): expected an array [type]
try {
  await Orders.create({ customer: "ann", tags: [], lines: [{ sku: "A", qty: 0 }, { qty: 1 } as never] });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "lines.0.qty": must be at least 1 [min]; "lines.1.sku": the field is required [required]
