import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true, index: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
connection.model(Account);
const raw = client.unsafeDriver().db("app").collection("accounts");
await connection.init();
await raw.dropIndex("owner_1");
await raw.createIndex({ owner: 1 }, { name: "owner_1", unique: true });
await raw.createIndex({ closed: 1 }, { name: "closed_1" });
// ---cut---
const plan = await connection.syncAll({ dryRun: true });
console.log(plan.collections[0]?.indexes);
// → { toCreate: ["owner_1"], toDrop: ["owner_1", "closed_1"], toModify: [], dryRun: true }
console.log(plan.inSync, plan.created);
// → false ["index accounts.owner_1"]
