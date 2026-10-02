import { BulkWriteError, type BulkWriteOperation, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true, unique: true })
  sku!: string;

  @Prop(() => String, { required: true, unique: true })
  name!: string;

  @Prop(() => Number, { required: true, min: 0 })
  price!: number;
}

export const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Products = client.db().model(Product);

export type Row = { sku: string; name: string; price: number };
export type Failure = { row: number; reason: string };

// write one portion; the schema checks every operation, refusals come back as indexes into this portion
const writePortion = async (rows: readonly Row[]) => {
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

// the whole import: portions, row numbers of the file, one report
export const importProducts = async (rows: readonly Row[], portionSize = 500) => {
  const report = { created: 0, updated: 0, rejected: [] as Failure[] };
  for (let start = 0; start < rows.length; start += portionSize) {
    const written = await writePortion(rows.slice(start, start + portionSize));
    report.created += written.created;
    report.updated += written.updated;
    for (const failure of written.failures) {
      report.rejected.push({ row: start + failure.index, reason: failure.reason });
    }
  }
  return report;
};
