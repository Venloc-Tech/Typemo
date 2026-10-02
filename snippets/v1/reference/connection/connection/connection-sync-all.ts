import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
connection.model(Account);
// ---cut---
const plan = await connection.syncAll({ dryRun: true });
console.log(plan.inSync, plan.created, plan.collections[0]?.indexes?.toCreate);
// → false ["collection accounts", "index accounts.title_1"] ["title_1"]
