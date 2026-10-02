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
  await session.withTransaction(async () => {
    await Accounts.create({ title: "Manual", balance: 1 }, { session });
  });
} finally {
  await session.endSession();
}
