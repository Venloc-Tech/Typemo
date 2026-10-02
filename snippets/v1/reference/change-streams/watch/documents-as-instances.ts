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
const stream = await Accounts.watch({ hydrate: true });
await Accounts.create({ owner: "ivan", balance: 3 });

const event = await stream.next();
if (event.operationType === "insert") {
  console.log(event.fullDocument instanceof Account, event.fullDocument.$isNew());
  // → true false
}
await stream.close();
