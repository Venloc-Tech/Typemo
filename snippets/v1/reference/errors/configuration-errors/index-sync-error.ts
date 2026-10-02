import { Entity, IndexSyncError, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
try {
  await Accounts.syncIndexes();
} catch (error) {
  if (error instanceof IndexSyncError) {
    console.log(error.model);
    // → "Account"
    console.log(error.failures.map((f) => [f.name, f.action, f.error.name]));
    // → [["title_1", "create", "DuplicateKeyError"]]
  }
}
