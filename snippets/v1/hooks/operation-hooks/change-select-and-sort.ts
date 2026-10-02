import { Entity, Pre, Prop, Schema, TypemoClient, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;

  @Pre("query.find")
  newestFirst(this: OperationHookContext<Account, "query.find">): void {
    this.modify({ select: { title: 1 }, sort: { title: -1 } });
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const rows = await Accounts.find().plain();
console.log(rows.map((row) => row.title));
// → ["c", "b", "a"]
