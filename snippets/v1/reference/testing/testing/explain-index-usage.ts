import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { explainIndexUsage } from "@venloc/typemo/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank-test" });
const Accounts = client.db().model(Account);
// ---cut---
const usage = await explainIndexUsage(Accounts.find({ title: "Account 1" }));
// → { stages: ["EXPRESS_IXSCAN"], indexes: ["title_1"], collectionScan: false, usesIndex: true,
//     docsExamined: 1, keysExamined: 1, docsReturned: 1, covered: false }
