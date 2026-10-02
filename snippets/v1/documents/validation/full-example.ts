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
export const createProduct = async (body: unknown) => {
  try {
    const value = await Products.validate(body);
    const product = await Products.create(value);
    return { ok: true as const, id: product._id };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false as const, problems: error.issues.map((issue) => ({ field: issue.path.join("."), reason: issue.reason })) };
    }
    throw error;
  }
};
