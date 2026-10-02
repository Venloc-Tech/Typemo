import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
declare const __sendEmail__: (text: string) => void;
// ---cut---
// wrong: the email goes out on every attempt
await client.transaction(async () => {
  __sendEmail__("transfer started");
  await Accounts.updateOne({ title: "Main" }, { $inc: { balance: 1 } });
});
// after one transient failure the email is sent twice

// right: the email after the commit
await client.transaction(async () => {
  await Accounts.updateOne({ title: "Main" }, { $inc: { balance: 1 } });
});
__sendEmail__("transfer done");
