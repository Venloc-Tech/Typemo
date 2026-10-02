import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const stream = await Accounts.watch((p) => p.match({ operationType: "update" }));
const account = await Accounts.create({ owner: "alice", balance: 100 });
await Accounts.updateOne({ _id: account._id }, { $inc: { balance: 50 } });

const event = await stream.next();
if (event.operationType === "update") {
  console.log(event.updateDescription.updatedFields, event.updateDescription.removedFields);
  // → { balance: 150 } []
}
await stream.close();
