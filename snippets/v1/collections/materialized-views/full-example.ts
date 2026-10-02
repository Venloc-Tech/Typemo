import { Entity, EntityWithId, fn, Materialized, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { required: true })
  balance!: number;

  @Prop(() => Boolean, { required: true })
  closed!: boolean;
}

@Schema({ collection: "owner_totals" })
class OwnerTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true })
  total!: number;

  @Prop(() => Number, { required: true })
  count!: number;
}

const main = async () => {
  const client = await TypemoClient.connect("mongodb://localhost:27017/app", { name: "main" });
  const connection = client.connection;
  connection.model(Account);

  // definition: totals of open accounts per owner, the result mirrors the pipeline
  const ownerTotals = Materialized.define(connection, OwnerTotal, {
    from: Account,
    mode: "replace",
    pipeline: (p) =>
      p.match({ closed: false }).group((f) => ({ _id: f.owner, total: fn.sum(f.balance), count: fn.sum(1) })),
  });

  // refresh: called on a schedule
  await ownerTotals.refresh();

  // read: an ordinary model
  const totals = await ownerTotals.model.find().sort({ _id: 1 }).lean();
  console.log(totals.length);

  await client.close();
};

await main();
