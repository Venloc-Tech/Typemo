import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
export const transfer = (from: string, to: string, amount: number) =>
  client.connection.transaction(async () => {
    const source = await Accounts.findOne({ title: from }).orFail();
    if (source.balance < amount) throw new Error("insufficient funds");
    await Accounts.updateOne({ title: from }, { $inc: { balance: -amount } });
    await Accounts.updateOne({ title: to }, { $inc: { balance: amount } });
    return source.balance - amount;
  });

console.log(await transfer("Main", "Savings", 30));
// → 70
