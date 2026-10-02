import { Entity, Prop, Schema, TypemoClient, type TransactionCallback } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const countAccounts: TransactionCallback<number> = async (scope) => {
  console.log(scope.attempt);
  // → 1
  return Accounts.countDocuments();
};

const count = await client.transaction(countAccounts);
//    ^?
