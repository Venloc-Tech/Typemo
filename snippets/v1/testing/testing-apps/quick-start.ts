import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { defineFactory } from "@venloc/typemo/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank-test" });
const Accounts = client.db().model(Account);
// ---cut---
const accountFactory = defineFactory(Accounts, (n) => ({ title: `Account ${n}`, balance: 100 }));

const rich = await accountFactory.create({ balance: 1_000_000 });
// → a document with title "Account 1" and balance 1000000
