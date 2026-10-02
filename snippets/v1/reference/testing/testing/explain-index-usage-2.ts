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
const covered = await explainIndexUsage(Accounts.find({ title: { $gte: "A" } }).select({ title: 1, _id: 0 }));
// → { stages: ["PROJECTION_COVERED", "IXSCAN"], indexes: ["title_1"], collectionScan: false, usesIndex: true,
//     docsExamined: 0, keysExamined: 3, docsReturned: 3, covered: true }
