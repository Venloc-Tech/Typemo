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
const report = await connection.init();
console.log(report.inSync, report.created);
// → true ["collection accounts", "index accounts.title_1"]
console.log(report.collections[0]?.indexes?.toCreate);
// → ["title_1"]
