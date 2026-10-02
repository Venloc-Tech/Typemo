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
const user = await Users.create({ name: "gina", passwordHash: "h1", email: "gina@example.com", resetToken: "tok" });
// a record appeared in the users_audit collection:
// → documents: [{ _id: "…", name: "gina", passwordHash: "?", email: "g***@example.com", resetToken: "[hidden]" }]
