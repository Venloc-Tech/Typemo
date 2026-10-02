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
  const main = await Accounts.findOne({ title: "Main" }).session(session).orFail();
  console.log(main.$session() === session);
  // → true

  main.balance = 60;
  await main.$save();
  await session.commitTransaction();

  main.$session(null);
  console.log(main.$session());
  // → undefined
} finally {
  await session.endSession();
}
