import { Entity, type Hidden, Prop, Schema, type Selected, TypemoClient } from "@venloc/typemo";
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
type BalanceRow = Selected<Account, "owner" | "balance">;

const rows = await Accounts.find({ owner: { $ne: "carol" } })
  .select({ owner: 1, balance: 1 })
  .sort({ owner: 1 })
  .plain()
  .expect<BalanceRow>();
console.log(rows.map((row) => [row.owner, row.balance]));
// → [["alice", 100], ["bob", 250]]
