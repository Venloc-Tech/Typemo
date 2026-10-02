import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const session = await client.startSession();
try {
  session.startTransaction();
  const account = await Accounts.findOne({ title: "Main" }).session(session).orFail();
  await Accounts.updateOne({ title: "Savings" }, { $inc: { balance: 10 } }).session(session);
  await Accounts.create({ title: "Extra", balance: 5 }, { session });
  await session.commitTransaction();
} finally {
  await session.endSession();
}
