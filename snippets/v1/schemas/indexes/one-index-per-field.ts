import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { index: true }) owner?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
console.log(Accounts.schema.describe().indexes);
// → [{ keys: { owner: 1 }, options: {} }]
