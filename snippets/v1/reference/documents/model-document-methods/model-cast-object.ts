import { type Defaulted, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { min: 0, max: 10, default: 1 }) size!: Defaulted<number>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Products = client.db().model(Product);
// ---cut---
console.log(Products.castObject({ name: "lamp", size: 3 }));
// → { name: "lamp", size: 3 }

console.log(Products.castObject({}));
// → {}
