import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
const Accounts = client.connection.model(Account);
const pending = Accounts.countDocuments(); // the client is not connected yet
await client.connect();
const total = await pending;
//    ^?
