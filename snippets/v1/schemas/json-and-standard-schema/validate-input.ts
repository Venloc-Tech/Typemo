import { Entity, type Defaulted, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users", validator: true })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true, lowercase: true, minLength: 3 })
  name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" })
  role!: Defaulted<"user" | "admin">;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
const good = await Users["~standard"].validate({ name: " Zed " });
// → { value: { _id: "…", name: "zed", role: "user" } }

const bad = await Users["~standard"].validate({ name: "a" });
console.log(bad);
// → { issues: [{ message: "must be at least 3 characters long", path: ["name"] }] }
