import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Spec.map(Number)) prices?: Map<string, number>;
}
const Products = client.connection.model(Product);
await Products.create({ title: "Lamp", prices: { USD: 10 } });
// ---cut---
await Products.updateOne({ title: "Lamp" }, { $set: { "prices.EUR": 9 } });
const found = await Products.find({ "prices.EUR": 9 }).plain();
console.log(found.length);
// → 1
