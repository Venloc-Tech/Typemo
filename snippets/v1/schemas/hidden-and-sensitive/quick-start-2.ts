import { Entity, type Hidden, Mask, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users", audit: true })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
  @Prop(() => String, { sensitive: Mask.email() }) email?: string;
  @Prop(() => String, { sensitive: "hide" }) resetToken?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
try {
  await Users.create({ name: "gina", email: 5 as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string failed at path "email" for "?" (string): expected a string [type]
