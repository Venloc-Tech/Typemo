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
// ---cut---
const result = await Products.bulkWrite(
  [
    { updateOne: { filter: { sku: "S1" }, update: { $set: { name: "One", price: 10 } }, upsert: true } },
    { updateOne: { filter: { sku: "S3" }, update: { $set: { name: "Three", price: 30 } }, upsert: true } },
  ],
  { ordered: false },
);
console.log(result.upsertedCount, result.matchedCount);
// → 2 0
