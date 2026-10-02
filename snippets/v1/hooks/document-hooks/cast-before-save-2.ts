import { Entity, type HookThis, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String) note?: string;
  @Pre("document.save")
  audit(this: HookThis<"document.save", Account>): void {
    if (!this.$isModified()) return;
    console.log("changes will be written");
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const account = await Accounts.create({ title: "Main" });
// → changes will be written
await account.$save();
// unchanged: the hook ran but returned at once
account.note = "checked";
await account.$save();
// → changes will be written
