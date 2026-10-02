import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) login!: string;
}
// ---cut---
export const registerUser = async (login: string) => {
  const Users = client.connection.model(User);
  return Users.create({ login });
};

console.log(client.connection.model(User) === client.connection.model(User));
// → true
