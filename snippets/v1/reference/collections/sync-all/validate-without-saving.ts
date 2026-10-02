import { Entity, Prop, Schema, SyncAll, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true, index: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
connection.model(Account);
// ---cut---
const plan = await SyncAll.run(connection, { dryRun: true });
console.log(plan.inSync, plan.collections[0]?.indexes?.dryRun);
// → false true
console.log(plan.created);
// → ["collection accounts", "index accounts.title_1", "index accounts.owner_1"]
