import { Entity, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Pre("document.save")
  normalizeTitle(this: Account): void {
    this.title = this.title.trim();
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const account = await Accounts.create({ title: "  Main  " });
console.log(JSON.stringify(account.title));
// → "Main"
