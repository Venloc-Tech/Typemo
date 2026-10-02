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
type Failure = { row: number; reason: string };
const writePortion = async (rows: readonly Row[]) => ({ created: rows.length, updated: 0, failures: [] as { index: number; reason: string }[] });
// ---cut---
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
