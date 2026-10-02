import { Entity, Pre, Prop, Schema, TypemoClient, type OperationHookContext } from "@venloc/typemo";
import { ObjectId } from "mongodb";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;

  @Pre("query.find")
  fromCache(this: OperationHookContext<Account, "query.find">): void {
    this.skip([{ _id: new ObjectId(), title: "cached", owner: "nobody" }]);
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const rows = await Accounts.find().plain();
console.log(rows.map((row) => row.title));
// → ["cached"]
