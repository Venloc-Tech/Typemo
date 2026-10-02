import { Entity, IndexSyncError, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true, index: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.connection.model(Account);
await client.unsafeDriver().db("app").collection("accounts").insertMany([
  { title: "Main", owner: "alice" },
  { title: "Main", owner: "bob" },
]);
// ---cut---
try {
  await Accounts.syncIndexes();
} catch (error) {
  if (error instanceof IndexSyncError) {
    for (const failure of error.failures) console.log(failure.name, failure.action, failure.error.name);
    // → "title_1" "create" "DuplicateKeyError"
  }
}
console.log((await Accounts.listIndexes()).map((index) => index.name));
// → ["_id_", "owner_1"]
