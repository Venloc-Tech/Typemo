import { Entity, fn, Prop, Schema, TypedView, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => Boolean, { required: true }) closed!: boolean;
}
@Schema({ collection: "open_accounts" })
class OpenAccount extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
const openAccounts = TypedView.define(connection, OpenAccount, {
  on: Account,
  pipeline: (p) => p.match({ closed: false }).project({ title: 1, owner: 1, balance: 1 }),
});
await openAccounts.ensure();
// ---cut---
const totals = await openAccounts.aggregate((p) => p.group((f) => ({ _id: f.owner, total: fn.sum(f.balance) })));
console.log(totals.find((row) => row._id === "alice")?.total);
// → 120
