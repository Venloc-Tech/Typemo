import { ObjectId } from "mongodb";
import { type Defaulted, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { min: 0, max: 10, default: 1 }) size!: Defaulted<number>;
  @Prop(() => [String]) tags!: string[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Products = client.db().model(Product);
// ---cut---
const product = Products.hydrate({ _id: new ObjectId(), name: "lamp", size: 3, tags: ["home"] });
console.log(product.$isNew(), product.$isModified(), product.tags.constructor.name);
// → false false "StrictArray"

product.name = "desk lamp";
console.log(product.$getChanges());
// → { $set: { name: "desk lamp" } }
