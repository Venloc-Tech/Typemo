import { Entity, EntityWithId, fn, Materialized, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => Boolean, { required: true }) closed!: boolean;
}
@Schema({ collection: "owner_totals" })
class OwnerTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Number, { required: true }) count!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
const Accounts = connection.model(Account);
const ownerTotals = Materialized.define(connection, OwnerTotal, {
  from: Account,
  pipeline: (p) =>
    p.match({ closed: false }).group((f) => ({ _id: f.owner, total: fn.sum(f.balance), count: fn.sum(1) })),
});
await ownerTotals.refresh();
// ---cut---
await Accounts.updateOne({ title: "Savings" }, { $set: { closed: true } });
await Accounts.updateOne({ title: "Main" }, { $set: { balance: 150 } });
await ownerTotals.refresh();
console.log(await ownerTotals.model.find().sort({ _id: 1 }).lean());
// → [{ _id: "alice", total: 150, count: 1 }, { _id: "bob", total: 500, count: 1 }]
