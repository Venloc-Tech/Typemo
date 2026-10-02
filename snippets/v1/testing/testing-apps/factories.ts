import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { defineFactory } from "@venloc/typemo/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank-test" });
const Accounts = client.db().model(Account);
const accountFactory = defineFactory(Accounts, (n) => ({ title: `Account ${n}`, balance: 100 }));
// ---cut---
const draft = accountFactory.build({ balance: 5 });
// → { title: "Account 1", balance: 5 }   (data, not saved)

const three = await accountFactory.createMany(3, (n) => ({ balance: n * 10 }));
// → three saved accounts: Account 2, 3, 4 with balance 20, 30, 40
