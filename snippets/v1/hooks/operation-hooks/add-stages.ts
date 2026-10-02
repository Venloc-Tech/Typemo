import { Entity, Pre, Prop, Schema, TypemoClient, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;

  @Pre("aggregate")
  capRows(this: OperationHookContext<Account, "aggregate">): void {
    this.modify({ stages: [{ $limit: 1 }] });
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const rows = await Accounts.aggregate((pipeline) => pipeline.match({ owner: "alice" }));
console.log(rows.length);
// → 1
