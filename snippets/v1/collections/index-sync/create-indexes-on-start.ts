import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true, index: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
export const prepareDatabase = async () => {
  client.connection.model(Account);
  const report = await client.connection.init();
  console.log(report.collections[0]?.indexes?.toCreate);
  // → ["title_1", "owner_1"]
  console.log(report.inSync, report.created);
  // → true ["collection accounts", "index accounts.title_1", "index accounts.owner_1"]
};
