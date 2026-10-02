import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
// wrong: the write happens before opening, the stream will not see it
await Accounts.create({ owner: "early", balance: 1 });
const late = await Accounts.watch();
console.log(await late.tryNext());
// → null
await late.close();

// right: the stream is opened before the write
const stream = await Accounts.watch();
await Accounts.create({ owner: "on time", balance: 1 });
console.log((await stream.next()).operationType);
// → "insert"
await stream.close();
