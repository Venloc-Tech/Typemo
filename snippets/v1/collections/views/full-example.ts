import { Entity, Prop, Schema, TypedView, TypemoClient } from "@venloc/typemo";

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

@Schema({ collection: "open_accounts" })
class OpenAccount extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { required: true })
  balance!: number;
}

const main = async () => {
  const client = await TypemoClient.connect("mongodb://localhost:27017/app", { name: "main" });
  const connection = client.connection;
  connection.model(Account);

  // definition: the pipeline is checked against the OpenAccount class
  const openAccounts = TypedView.define(connection, OpenAccount, {
    on: Account,
    pipeline: (p) => p.match({ closed: false }).project({ title: 1, owner: 1, balance: 1 }),
  });

  // startup: creates collections, indexes and views
  await connection.init();

  // read: plain objects with every field of the class
  const rows = await openAccounts.find({ owner: "alice" });
  console.log(rows.length);

  await client.close();
};

await main();
