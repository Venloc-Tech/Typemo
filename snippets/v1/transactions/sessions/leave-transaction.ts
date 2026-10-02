import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
await client
  .transaction(async () => {
    await Accounts.updateOne({ title: "Savings" }, { $inc: { balance: 100 } }).session(null);
    throw new Error("abort");
  })
  .catch(() => undefined);
