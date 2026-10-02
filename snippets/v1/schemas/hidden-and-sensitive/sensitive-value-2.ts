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
await Users.updateOne({ name: "gina" }, { $set: { passwordHash: "h2" } });
// log entry: filter: { name: "gina" }, update: { $set: { passwordHash: "?" } }
