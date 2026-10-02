import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Spec.map(Number))
  prices?: Map<string, number>;
}

const Products = client.connection.model(Product);
const product = await Products.create({ title: "Lamp", prices: { USD: 10, EUR: 9 } });
product.prices?.set("GBP", 8);
console.log([...(product.prices ?? [])]);
// → [["USD", 10], ["EUR", 9], ["GBP", 8]]
