import { Entity, Pre, Prop, Schema, TypemoClient, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 0 }) price!: number;

  @Pre("query.updateOne")
  count(this: OperationHookContext<Product, "query.updateOne">): void {
    console.log("pre updateOne", this.bulkIndex);
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Products = client.db().model(Product);
// ---cut---
await Products.bulkWrite(
  [
    { updateOne: { filter: { sku: "a" }, update: { $set: { price: 1 } }, upsert: true } },
    { updateOne: { filter: { sku: "b" }, update: { $set: { price: -1 } }, upsert: true } },
  ],
  { ordered: false },
).catch((error) => console.log((error as Error).message));
// → pre updateOne 0
// → Product.bulkWrite: 1 write(s) failed (first at index 1: Validation failed: "price": must be at least 0 [min])
