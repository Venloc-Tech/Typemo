import { BulkWriteError, Entity, Prop, Schema, TypemoClient, type BulkWriteOperation } from "@venloc/typemo";
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true, unique: true }) sku!: string;
  @Prop(() => String, { required: true, unique: true }) name!: string;
  @Prop(() => Number, { required: true, min: 0 }) price!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Products = client.db().model(Product);
type Row = { sku: string; name: string; price: number };
const importProducts = async (rows: readonly Row[], portionSize = 500) => ({ created: 0, updated: 0, rejected: [] as { row: number; reason: string }[] });
// ---cut---
const report = await importProducts(
  [
    { sku: "S1", name: "One", price: 10 },
    { sku: "S2", name: "Existing", price: 20 },
    { sku: "S3", name: "Three", price: 30 },
    { sku: "S4", name: "Four", price: -5 },
    { sku: "S1", name: "One!", price: 11 },
    { sku: "S5", name: "Five", price: 50 },
  ],
  2,
);
console.log(report);
// → { created: 3, updated: 1, rejected: [
//     { row: 1, reason: "DuplicateKeyError" },
//     { row: 3, reason: "ValidationError" },
//   ] }
