import { type Defaulted, Entity, Schema, Prop, TypemoClient } from "@venloc/typemo";
import { Pre, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Boolean, { default: false }) archived!: Defaulted<boolean>;
  @Pre("query.find")
  onlyActive(this: OperationHookContext<Account, "query.find">): void {
    this.modify({ where: { archived: false } });
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const mine = await Accounts.find({ owner: "alice" }).sort({ title: 1 }).plain();
console.log(mine.map((account) => account.title));
// → ["a", "b"]
