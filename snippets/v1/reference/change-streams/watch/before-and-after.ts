import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const stream = await Accounts.watch({
  fullDocument: "updateLookup",
  fullDocumentBeforeChange: "whenAvailable",
});
const account = await Accounts.create({ owner: "bob", balance: 10 });
await stream.next();

await Accounts.updateOne({ _id: account._id }, { $set: { balance: 20 } });
const event = await stream.next();
if (event.operationType === "update") {
  console.log(event.fullDocumentBeforeChange?.balance, event.fullDocument?.balance);
  //                                                          ^?
  // → 10 20
}
await stream.close();
