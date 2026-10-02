import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) number!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
await client.connection.init();
// ---cut---
await Accounts.create({ number: "1" });
try {
  await Accounts.create({ number: "1" });
} catch (error) {
  console.log((error as Error).message);
}
// → duplicate key on number_1: { number: "1" } (code 11000 DuplicateKey)
