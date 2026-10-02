import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Spec.map(Number)) prices?: Map<string, number>;
}
const Products = client.connection.model(Product);
// ---cut---
try {
  await Products.create({ title: "Lamp", prices: { "a.b": 1 } });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Map key failed at path "prices.a.b" for "a.b" (string): a key cannot contain "." (it would be read as a path) [key]
try {
  await Products.create({ title: "Lamp", prices: { $x: 1 } });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Map key failed at path "prices.$x" for "$x" (string): a key cannot start with "$" (reserved for operators) [key]
try {
  await Products.create({ title: "Lamp", prices: { "": 1 } });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Map key failed at path "prices" for "" (string): an empty key cannot be addressed by a path [key]
