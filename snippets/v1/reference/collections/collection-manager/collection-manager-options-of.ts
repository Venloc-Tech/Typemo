import { CollectionManager, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true }) note!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Ledger = client.connection.model(LedgerEntry);
const db = client.unsafeDriver().db("app");
// ---cut---
console.log(CollectionManager.optionsOf(Ledger));
// → { capped: true, size: 65536, max: 100 }

console.log(await CollectionManager.create(db, Ledger));
// → true
console.log(await CollectionManager.create(db, Ledger.schema));
// → false

console.log(await CollectionManager.ensure(db, Ledger, { dryRun: true }));
// → { result: "unchanged", differences: [] }
