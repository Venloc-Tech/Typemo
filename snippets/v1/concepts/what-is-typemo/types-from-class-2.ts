import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => BigInt, { required: true }) balance!: bigint;
  @Prop(() => Date) openedAt?: Date;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.connection.model(Account);
// ---cut---
const rows = await Accounts.find({ owner: "ann" }).select({ owner: 1, balance: 1 }).plain();
const first = rows[0];
//    ^?
const lean = await Accounts.findOne({ owner: "ann" }).orFail().lean();
const leanBalance = lean.balance;
//    ^?
