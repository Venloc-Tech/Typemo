import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { expectCollScan } from "@venloc/typemo/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank-test" });
const Accounts = client.db().model(Account);
// ---cut---
const usage = await expectCollScan(Accounts.find({ balance: 100 }));
// → usage.collectionScan === true
