import { DuplicateKeyError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
await client.connection.init();
await Accounts.create({ title: "Main", owner: "alice" });
// ---cut---
try {
  await Accounts.create({ title: "Main", owner: "bob" });
} catch (error) {
  if (error instanceof DuplicateKeyError) console.log(Object.keys(error.keyPattern ?? {}));
  // → ["title"]
}
