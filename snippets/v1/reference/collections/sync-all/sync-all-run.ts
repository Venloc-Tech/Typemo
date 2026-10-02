import { Entity, Prop, Schema, SyncAll, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true, index: true }) owner!: string;
}
@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true }) note!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
connection.model(Account);
connection.model(LedgerEntry);
// ---cut---
const report = await SyncAll.run(connection);
console.log(report.inSync, report.failed);
// → false false
console.log(report.collections.map((c) => [c.collection, c.options?.result, c.indexes?.toCreate]));
// → [["accounts", "created", ["title_1", "owner_1"]], ["ledger", "created", []]]
console.log(report.created);
// → ["collection accounts", "index accounts.title_1", "index accounts.owner_1", "collection ledger"]
