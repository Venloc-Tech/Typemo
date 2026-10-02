import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
client.connection.model(Account);
// ---cut---
const report = await client.connection.init();
console.log(report.inSync, report.created);
// → true ["collection accounts", "index accounts.title_1"]
