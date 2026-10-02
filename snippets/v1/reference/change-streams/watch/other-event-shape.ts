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
const stream = await Accounts.watch(
  (p) => p.project({ operationType: 1, "fullDocument.owner": 1 }),
  { include: ["pin"] },
);
await Accounts.create({ owner: "fay", balance: 1 });

console.log(await stream.next());
// → { _id: { _data: "…" }, operationType: "insert", fullDocument: { owner: "fay" } }
await stream.close();
