import { Entity, Prop, Schema, TypemoClient, untrusted } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Users = client.connection.model(User);
// ---cut---
export const findByName = async (body: unknown) => {
  return Users.find(untrusted({ name: (body as { name: unknown }).name }) as { name: string }).plain();
};
