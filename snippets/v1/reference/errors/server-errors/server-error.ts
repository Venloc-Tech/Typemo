import { Entity, Prop, Schema, ServerError, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
await Accounts.create({ title: "Main", owner: "alice" });
// ---cut---
try {
  await Accounts.find().hint("nope_1");
} catch (error) {
  if (error instanceof ServerError) {
    console.log(error.message);
    // → hint provided does not correspond to an existing index (code 2 BadValue)
    console.log(error.code, error.codeName);
    // → 2 "BadValue"
    console.log(error.serverMessage.startsWith("error enumerating plans for query"));
    // → true
    console.log((error.cause as Error).name);
    // → "MongoServerError"
  }
}
