import { Entity, type Defaulted, type Immutable, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { immutable: true }) country?: Immutable<string>;
  @Prop(() => Number, { default: 0 }) balance!: Defaulted<number>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
await Accounts.updateOne({ balance: 0 }, { $setOnInsert: { country: "FR" } }, { upsert: true });
// a document with country: "FR" is created; the next upsert on it leaves country alone
