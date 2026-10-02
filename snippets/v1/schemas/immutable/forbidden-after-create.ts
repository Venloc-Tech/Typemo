import { Entity, type Defaulted, type Immutable, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { immutable: true }) country?: Immutable<string>;
  @Prop(() => Number, { default: 0 }) balance!: Defaulted<number>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const account = await Accounts.create({ country: "PL" });
try {
  await Accounts.updateOne({ _id: account._id }, { $set: { country: "DE" } } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → $set.country: "country" is immutable; it is written only when the document is created ($setOnInsert on upsert) [immutable]
