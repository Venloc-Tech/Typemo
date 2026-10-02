import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true }) note!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Ledger = client.connection.model(LedgerEntry);
// ---cut---
const first = await Ledger.ensureCollection();
console.log(first.result);
// → "created"
const second = await Ledger.ensureCollection();
console.log(second.result);
// → "unchanged"
