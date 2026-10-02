import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String) note?: string;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
type BalanceRow = { _id: string; owner: string; balance: string };

// @errors: 2684
await Accounts.find().select({ owner: 1, balance: 1 }).plain().expect<BalanceRow>();
// compiler: … is not assignable to method's 'this' of type '{ readonly mismatch: "balance"; }'
