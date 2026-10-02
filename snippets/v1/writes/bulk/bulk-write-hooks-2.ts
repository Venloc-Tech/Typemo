import { type Defaulted, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
  @Prop(() => String) note?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
await Accounts.bulkWrite([
  { updateOne: { filter: { title: "Main" }, update: { $set: { owner: "bulk" } } } },
  { insertOne: { document: { title: "H1", owner: "o" } } },
  { updateOne: { filter: { title: "Ghost" }, update: { $set: { owner: "g" } }, upsert: true } },
  { deleteOne: { filter: { title: "H1" } } },
]);
// → post bulkWrite, matched 1
// → post updateOne 0 no upsert
// → post save H1
// → post updateOne 2 upsert
// → post deleteOne 3 null
