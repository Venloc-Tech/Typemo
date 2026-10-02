import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
const doc = await Users.findOne({ name: "gina" }).select({ "+passwordHash": true }).orFail();
console.log(doc.passwordHash);
// → "h1"
console.log(doc.$toPlain());
// → { _id: "…", name: "gina" }
console.log(doc.$toPlain({ hidden: true }));
// → { _id: "…", name: "gina", passwordHash: "h1" }
