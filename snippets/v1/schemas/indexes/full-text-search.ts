import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Index({ title: "text", note: "text" }, { weights: { title: 5 }, name: "search" }) // [!code highlight]
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String) title?: string;
  @Prop(() => String) note?: string;
}
const Accounts = client.db().model(Account);
console.log(Accounts.schema.describe().indexes);
// → [{ keys: { title: "text", note: "text" }, options: { weights: { title: 5 }, name: "search" } }]
