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
export const refreshTotals = async () => {
  await ownerTotals.refresh();
};

await Accounts.updateOne({ title: "Main" }, { $set: { balance: 150 } });
console.log((await ownerTotals.model.findOne({ _id: "alice" }))?.total);
// → 120

await refreshTotals();
console.log((await ownerTotals.model.findOne({ _id: "alice" }))?.total);
// → 150
