import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
const session = await client.startSession();
session.startTransaction();
// ---cut---
// wrong: the session is not passed, the write is outside the transaction
await Accounts.create({ title: "Forgot", balance: 1 });

// right: the write uses the same session
await Accounts.create({ title: "Kept", balance: 1 }, { session });
