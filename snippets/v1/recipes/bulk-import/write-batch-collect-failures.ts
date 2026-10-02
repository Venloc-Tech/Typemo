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
export const writePortion = async (rows: readonly Row[]) => {
  const operations: BulkWriteOperation<Product>[] = rows.map((row) => ({
    updateOne: { filter: { sku: row.sku }, update: { $set: { name: row.name, price: row.price } }, upsert: true },
  }));
  try {
    const result = await Products.bulkWrite(operations, { ordered: false });
    return { created: result.upsertedCount, updated: result.modifiedCount, failures: [] as { index: number; reason: string }[] };
  } catch (error) {
    if (!(error instanceof BulkWriteError)) throw error;
    return {
      created: error.result.upsertedCount,
      updated: error.result.modifiedCount,
      failures: error.writeErrors.map((failure) => ({ index: failure.index, reason: failure.error.name })),
    };
  }
};
