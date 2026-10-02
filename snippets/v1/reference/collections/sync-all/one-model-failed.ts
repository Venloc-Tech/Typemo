import { Entity, Prop, Schema, SyncAll, SyncError, TypemoClient } from "@venloc/typemo";
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
const db = client.unsafeDriver().db("app");
await db.createCollection("ledger");
await db.collection("accounts").insertMany([
  { title: "Main", owner: "alice" },
  { title: "Main", owner: "bob" },
]);
// ---cut---
try {
  await SyncAll.run(connection);
} catch (error) {
  if (error instanceof SyncError) {
    console.log(error.failures.map((f) => [f.kind, f.name, f.model, f.errors.map((e) => e.name)]));
    // → [["collection", "accounts", "Account", ["IndexSyncError"]],
    //    ["collection", "ledger", "LedgerEntry", ["CollectionOptionsError"]]]
  }
}
