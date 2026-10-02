import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const first = await Accounts.watch();
await Accounts.create({ owner: "g1", balance: 1 });
await Accounts.create({ owner: "g2", balance: 1 });
await first.next();
const token = first.resumeToken;
await first.close();

const resumed = await Accounts.watch({ resumeAfter: token });
const event = await resumed.next();
if (event.operationType === "insert") console.log(event.fullDocument.owner);
// → "g2"
await resumed.close();
