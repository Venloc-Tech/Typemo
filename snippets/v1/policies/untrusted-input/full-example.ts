import { Entity, Prop, Schema, TypemoClient, untrusted } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Users = client.connection.model(User);
// ---cut---
// your code: input form validation
declare const __parseQuery__: (raw: unknown) => { readonly name: string };

export const searchUsers = async (raw: unknown) => {
  const query = __parseQuery__(raw);
  // safety net: even a validated value goes through untrusted
  return Users.find({ name: untrusted(query.name) }).plain();
};
