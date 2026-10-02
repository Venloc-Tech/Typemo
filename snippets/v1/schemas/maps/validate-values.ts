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
  await Products.create({ title: "Lamp", prices: { USD: "x" as never } });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to number failed at path "prices.USD" for "x" (string): expected a number [type]
