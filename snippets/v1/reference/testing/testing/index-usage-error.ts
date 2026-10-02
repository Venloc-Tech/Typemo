import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { expectIndexScan, IndexUsageError } from "@venloc/typemo/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => Number, { required: true }) balance!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank-test" });
const Accounts = client.db().model(Account);
// ---cut---
try {
  await expectIndexScan(Accounts.find({ balance: 100 }));
} catch (error) {
  if (error instanceof IndexUsageError) console.log(error.usage.stages);
  // → ["COLLSCAN"]
}
