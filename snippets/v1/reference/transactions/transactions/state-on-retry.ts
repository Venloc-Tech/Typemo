import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const account = await Accounts.findOne({ title: "Main" }).orFail();

await client.transaction(async () => {
  account.balance = account.balance - 10;
  await account.$save();
});
// after one transient failure: 80 in the database, not 90
