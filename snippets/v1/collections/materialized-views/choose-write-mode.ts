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
// ---cut---
await Accounts.updateOne({ title: "Savings" }, { $set: { closed: true } });

const totals = Materialized.define(connection, OwnerTotal, {
  from: Account,
  mode: "replace",
  pipeline: (p) =>
    p.match({ closed: false }).group((f) => ({ _id: f.owner, total: fn.sum(f.balance), count: fn.sum(1) })),
});
await totals.refresh();
console.log((await totals.model.find().sort({ _id: 1 }).lean()).map((row) => row._id));
// → ["alice"]
