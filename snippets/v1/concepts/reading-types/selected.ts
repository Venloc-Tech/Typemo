import { Entity, Prop, Schema, TypemoClient, type Hidden, type Selected } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => BigInt, { required: true }) balance!: bigint;
  @Prop(() => Date) openedAt?: Date;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.connection.model(Account);
// ---cut---
type BalanceRow = Selected<Account, "owner" | "balance">;
declare const row: BalanceRow;
const shown = row;
//    ^?
const rows = await Accounts.find().select({ owner: 1, balance: 1 }).plain();
//    ^?
