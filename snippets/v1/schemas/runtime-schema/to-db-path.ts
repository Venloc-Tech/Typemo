import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ nested: true })
class Address {
  @Prop(() => String, { dbName: "c" }) city?: string;
}
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { dbName: "e", required: true }) email!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
  @Prop(() => Address) address?: Address;
  @Prop(() => [String]) tags?: string[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
export const countByEmail = async (email: string) => {
  const path = Users.schema.toDbPath("email");
  if (path === undefined) throw new Error("no such path");
  return client.unsafeDriver().db("app").collection("users").countDocuments({ [path]: email });
};

console.log(Users.schema.toDbPath("tags.0"), Users.schema.toDbPath("address.nope"));
// → tags.0 undefined
