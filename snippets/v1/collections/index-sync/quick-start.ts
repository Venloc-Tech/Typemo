import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true, index: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
const Accounts = connection.model(Account);
// ---cut---
await connection.init(); // only creates what is missing
await connection.syncAll(); // brings everything into exact match
await Accounts.syncIndexes(); // the same for one model
