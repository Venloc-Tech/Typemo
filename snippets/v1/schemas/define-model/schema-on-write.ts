import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) login!: string;
}
const Users = client.connection.model(User);
// ---cut---
try {
  await Users.create({ login: "bob", nick: "b" } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to User failed at path "nick" for "b" (string): not a field of User [unknown-key]
