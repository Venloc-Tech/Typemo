import { Entity, Prop, Schema, TypemoClient, StrictModeError } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const filter = JSON.parse('{"nope":1}');

try {
  await Accounts.find(filter);
} catch (error) {
  if (error instanceof StrictModeError) {
    console.log(error.message);
    // → filter: "nope" is not a field of Account [unknown-path]
    console.log(error.reason, error.path);
    // → "unknown-path" "filter.nope"
  }
}
