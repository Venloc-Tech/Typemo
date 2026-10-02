import { Entity, Index, IndexSyncError, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Index({ opened: 1 }, { name: "opened_ttl", expireAfterSeconds: 3600 })
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true, index: true }) owner!: string;
  @Prop(() => Date) opened?: Date;
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
    console.log(error.model, error.failures.map((f) => [f.name, f.action, f.error.name]));
    // → "Account" [["title_1", "create", "DuplicateKeyError"]]
    console.log((await Accounts.listIndexes()).map((index) => index.name));
    // → ["_id_", "owner_1", "opened_ttl"]
  }
}
