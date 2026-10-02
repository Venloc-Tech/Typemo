import { CollectionOptionsError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true }) note!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Ledger = client.connection.model(LedgerEntry);
await client.unsafeDriver().db("app").createCollection("ledger");
// ---cut---
try {
  await Ledger.ensureCollection({ update: true });
} catch (error) {
  if (error instanceof CollectionOptionsError) {
    console.log(error.differences.map((d) => [d.option, d.mutable]));
    // → [["capped", false]]
  }
}
