import { Entity, Pre, Prop, Schema, TypemoClient, type OperationHookContext } from "@venloc/typemo";
export const settings = { dryRun: false };
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;

  @Pre("query.deleteMany")
  dryRun(this: OperationHookContext<Account, "query.deleteMany">): void {
    if (settings.dryRun) this.skip({ acknowledged: true, deletedCount: 0 });
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
settings.dryRun = true;
const result = await Accounts.deleteMany({ owner: "bob" });
console.log(result, await Accounts.countDocuments());
// → { acknowledged: true, deletedCount: 0 } 3
