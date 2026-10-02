import { Entity, Prop, Schema, Spec, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
// ---cut---
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Spec.map(String)) preferences?: Map<string, string>;
}
const Users = client.db().model(User);
const user = await Users.create({ name: "Ann", preferences: new Map([["theme", "dark"]]) });
console.log(user.preferences?.get("theme"));
// → dark
