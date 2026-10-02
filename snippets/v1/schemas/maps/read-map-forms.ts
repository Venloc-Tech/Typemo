import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Spec.map(Number)) prices?: Map<string, number>;
}
const Products = client.connection.model(Product);
await Products.create({ title: "Lamp", prices: { USD: 10, EUR: 9 } });
// ---cut---
const plain = await Products.findOne({ title: "Lamp" }).plain();
console.log(plain?.prices instanceof Map);
// → true
const doc = await Products.findOne({ title: "Lamp" }).orFail();
console.log(doc.$toJSON().prices);
// → { USD: 10, EUR: 9 }
const lean = await Products.findOne({ title: "Lamp" }).lean();
console.log(lean?.prices instanceof Map);
// → false
