import { Entity, Prop, Schema, TypemoClient, untrusted, StrictModeError } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Users = client.connection.model(User);
// ---cut---
const fromQuery: Record<string, unknown> = JSON.parse('{"nope":"x"}');
try {
  await Users.find(untrusted(fromQuery)).plain();
} catch (error) {
  if (error instanceof StrictModeError) console.log(error.message);
  // → filter: "nope" is not a field of User [unknown-path]
}
