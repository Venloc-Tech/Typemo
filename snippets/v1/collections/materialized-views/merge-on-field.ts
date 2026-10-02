import { ConfigurationError, Entity, Index, Materialized, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
@Index({ title: 1 }, { unique: true })
@Schema({ collection: "account_balances" })
class AccountBalance extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
// ---cut---
const balances = Materialized.define(connection, AccountBalance, {
  from: Account,
  on: "title",
  pipeline: (p) => p.project({ _id: 0, title: 1, balance: 1 }),
});

try {
  await balances.refresh();
} catch (error) {
  if (error instanceof ConfigurationError) console.log("no unique index yet");
  // → "no unique index yet"
}

await balances.model.syncIndexes();
await balances.refresh();
console.log(await balances.model.countDocuments());
// → 3
