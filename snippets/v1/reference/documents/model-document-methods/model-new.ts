import { type Defaulted, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, {
    required: true,
    validate: async (value: string) => value !== "bad" || "the name is taken",
  })
  name!: string;
  @Prop(() => Number, { min: 0, max: 10, default: 1 }) size!: Defaulted<number>;
  @Prop(() => String, { enum: ["a", "b"] }) kind?: "a" | "b";
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Products = client.db().model(Product);
// ---cut---
const product = Products.new({ name: "lamp" });
console.log(product.$isNew(), product.size, product._id.constructor.name);
// → true 1 "ObjectId"

await product.$save();
console.log(product.$isNew());
// → false
