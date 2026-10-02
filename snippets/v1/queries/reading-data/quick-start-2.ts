import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => BigInt, { required: true }) balance!: bigint;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.db().model(Account);
// ---cut---
// 1. Document: to change and save
const account = await Accounts.findOne({ title: "Main" }).orFail();

// 2. plain: to return to the client
const forClient = await Accounts.findOne({ title: "Main" }).plain().orFail();
//    ^?
// → { _id: "…", title: "Main", balance: "9007199254741093" }

// 3. lean: to compute inside the application
const raw = await Accounts.findOne({ title: "Main" }).lean().orFail();
//    ^?
// → { _id: ObjectId("…"), title: "Main", balance: 9007199254741093n }
