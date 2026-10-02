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
const description = Users.schema.describe();
console.log(description.paths.email);
// → { kind: "scalar", type: "string", dbPath: "e", flags: "required" }
console.log(Object.keys(description.paths));
// → ["_id", "email", "passwordHash", "address", "address.city", "tags", "tags.$"]
