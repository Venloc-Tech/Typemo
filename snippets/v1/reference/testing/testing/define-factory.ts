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
const accounts = defineFactory(Accounts, (n) => ({ title: `Account ${n}`, balance: 100 }));

const draft = accounts.build({ balance: 5 });
// → { title: "Account 1", balance: 5 }
const saved = await accounts.createMany(2);
// → documents with title "Account 2" and "Account 3"
