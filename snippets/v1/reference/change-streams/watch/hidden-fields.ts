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
const hidden = await Accounts.watch();
const shown = await Accounts.watch({ include: ["pin"] });

await Accounts.create({ owner: "eve", balance: 1, pin: "77" });

const a = await hidden.next();
const b = await shown.next();
if (a.operationType === "insert" && b.operationType === "insert") {
  console.log(a.fullDocument, b.fullDocument);
  // → { _id: "…", owner: "eve", balance: 1 } { _id: "…", owner: "eve", balance: 1, pin: "77" }
}
await hidden.close();
await shown.close();
