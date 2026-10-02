import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true }) note!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Ledger = client.connection.model(LedgerEntry);
await client.unsafeDriver().db("app").createCollection("ledger", { capped: true, size: 1024, max: 100 });
// ---cut---
const plan = await Ledger.ensureCollection({ dryRun: true });
console.log(plan.result, plan.differences);
// → "updated" [{ option: "size", mutable: true, wanted: 65536, actual: 1024 }]

const done = await Ledger.ensureCollection({ update: true });
console.log(done.result);
// → "updated"
console.log((await Ledger.ensureCollection()).result);
// → "unchanged"
