import { Entity, Prop, Schema, TypemoClient, untrusted, StrictModeError } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Users = client.connection.model(User);
// ---cut---
const body = JSON.parse('{"name":{"$gt":""}}') as { name: string };

const found = await Users.find({ name: body.name }).plain();
console.log(found.map((user) => user.name));
// → ["ann", "bob", "cy"]
