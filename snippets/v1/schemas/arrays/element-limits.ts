import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => [String], { enum: ["new", "sale"] as const }) // [!code highlight]
  labels?: ("new" | "sale")[];

  @Prop(() => [Number], { min: 1 }) // [!code highlight]
  ratings?: number[];
}
const Products = client.connection.model(Product);
try {
  await Products.create({ labels: ["new", "hot" as never], ratings: [5, 0] });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "labels.1": must be one of "new", "sale" [enum]; "ratings.1": must be at least 1 [min]
