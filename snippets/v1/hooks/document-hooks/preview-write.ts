import { type Defaulted, Entity, type HookThis, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { default: 0 }) balance!: Defaulted<number>;

  @Pre("document.save")
  describeSave(this: HookThis<"document.save", Account>): void {
    if (!this.$isRoot()) return;
    console.log(this.$isNew(), JSON.stringify(this.$getChanges()));
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const account = await Accounts.create({ title: "Main" });
account.balance = 5;
await account.$save();
// → true {"$set":{"_id":"…","title":"Main","balance":0}}
// → false {"$set":{"balance":5}}
