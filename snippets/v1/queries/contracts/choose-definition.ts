import { Entity, type Hidden, Prop, Schema, type SelectedLean, TypemoClient } from "@venloc/typemo";
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
type LeanRow = SelectedLean<Account, "owner" | "balance" | "-_id">;

const rows = await Accounts.find({ owner: "alice" })
  .select({ owner: 1, balance: 1, _id: 0 })
  .lean()
  .expect<LeanRow>();
console.log(rows);
// → [{ owner: "alice", balance: 100 }]
