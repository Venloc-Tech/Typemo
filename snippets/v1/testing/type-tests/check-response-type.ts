import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>(): void => {};

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank-test" });
const Accounts = client.db().model(Account);
// ---cut---
const rows = await Accounts.find().select({ title: 1, balance: 1 }).plain();
//    ^?

assertType<Equal<(typeof rows)[number]["title"], string>>();
