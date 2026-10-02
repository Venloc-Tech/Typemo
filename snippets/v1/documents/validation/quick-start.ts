import { type Defaulted, Entity, Prop, Schema, TypemoClient, ValidationError } from "@venloc/typemo";
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
const product = Products.new({ name: "bad", size: 99 });

try {
  await product.$validate();
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.issues.map((issue) => [issue.path.join("."), issue.reason]));
    // → [["name", "validator"], ["size", "max"]]
  }
}
