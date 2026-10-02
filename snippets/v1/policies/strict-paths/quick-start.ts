import { Entity, Prop, Schema, TypemoClient, StrictModeError } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Users = client.connection.model(User);
// ---cut---
const filter = JSON.parse('{"nope":1}');
try {
  await Users.find(filter);
} catch (error) {
  if (error instanceof StrictModeError) console.log(error.reason, error.path);
  // → "unknown-path" "filter.nope"
}
