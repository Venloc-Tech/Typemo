import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
export const findForLogin = async (name: string) =>
  Users.findOne({ name }).select({ "+passwordHash": true }).lean();

const user = await findForLogin("gina");
console.log(user?.passwordHash);
// → "h1"
