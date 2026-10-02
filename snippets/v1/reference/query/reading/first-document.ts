import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
const youngest = await Users.findOne().sort({ age: 1 }).plain();
// → { _id: "…", name: "Bob", age: 17, tags: ["dev"] }
