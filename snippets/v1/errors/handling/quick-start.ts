import { DocumentNotFoundError, DuplicateKeyError, Entity, Prop, Schema, TypemoClient, TypemoError } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
await client.connection.init();
// ---cut---
try {
  await Accounts.findOne({ title: "no such account" }).orFail();
} catch (error) {
  if (error instanceof DocumentNotFoundError) console.log("not found");
  // → "not found"
  else if (error instanceof DuplicateKeyError) console.log("already exists");
  else if (error instanceof TypemoError) console.log(error.message);
  else throw error;
}
