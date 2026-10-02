import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { expectIndexScan } from "@venloc/typemo/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank-test" });
const Accounts = client.db().model(Account);
// ---cut---
await expectIndexScan(Accounts.find({ title: "Account 1" }), { index: "title_1", maxDocsExamined: 1 });
// passes and returns IndexUsage

await expectIndexScan(Accounts.find({ balance: 100 }));
// throws IndexUsageError
