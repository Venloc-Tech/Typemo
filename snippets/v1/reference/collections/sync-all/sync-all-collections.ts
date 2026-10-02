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
// ---cut---
console.log(SyncAll.collections(connection).map((schema) => schema.collection));
// → []

connection.model(Account);
connection.model(LedgerEntry);
console.log(SyncAll.collections(connection).map((schema) => schema.collection));
// → ["accounts", "ledger"]
