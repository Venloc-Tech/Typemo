import { Entity, type Defaulted, type Immutable, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { immutable: true }) // [!code highlight]
  country?: Immutable<string>;
}

const Accounts = client.db().model(Account);
await Accounts.create({ country: "PL" });
// @errors: 2769
await Accounts.updateOne({ country: "PL" }, { $set: { country: "DE" } });
