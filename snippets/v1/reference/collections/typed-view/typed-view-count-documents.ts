import { Entity, Prop, Schema, TypedView, TypemoClient } from "@venloc/typemo";
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
console.log(await openAccounts.countDocuments());
// → 2
console.log(await openAccounts.countDocuments({ balance: { $gt: 200 } }));
// → 1
