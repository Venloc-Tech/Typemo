import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const left = await client.transaction(async () => {
  const source = await Accounts.findOne({ title: "Main" }).orFail();
  await Accounts.updateOne({ title: "Main" }, { $inc: { balance: -30 } });
  await Accounts.updateOne({ title: "Savings" }, { $inc: { balance: 30 } });
  return source.balance - 30;
});
console.log(left);
// → 70  (account Main had 100)
