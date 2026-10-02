import { Entity, Prop, Schema, TypemoClient, untrusted, StrictModeError } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Users = client.connection.model(User);
// ---cut---
const body = JSON.parse('{"name":{"$ne":"zzz"}}') as { name: string };
try {
  await Users.find(untrusted(body)).plain();
} catch (error) {
  if (error instanceof StrictModeError) console.log(error.reason, error.path);
  // → "sanitize" "name.$ne"
}
