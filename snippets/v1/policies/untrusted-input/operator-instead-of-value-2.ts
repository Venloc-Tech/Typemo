import { Entity, Prop, Schema, TypemoClient, untrusted, StrictModeError } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Users = client.connection.model(User);
// ---cut---
const body = JSON.parse('{"name":{"$gt":""}}') as { name: string };

try {
  await Users.find(untrusted({ name: body.name })).plain();
} catch (error) {
  if (error instanceof StrictModeError) console.log(error.message);
}
// → untrusted value: "$gt" at "name.$gt" — an operator inside data from outside (query selector injection); validate the input and build the filter yourself [sanitize]
