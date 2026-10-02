import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
const Accounts = client.db().model(Account);
// ---cut---
const rows = await Accounts.find({ balance: { $gt: 100 } }).select({ title: 1 }).plain();
//    ^?
