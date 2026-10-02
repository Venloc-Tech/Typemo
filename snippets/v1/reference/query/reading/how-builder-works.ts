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
const query = Users.find({ age: { $gte: 18 } })
  .sort({ name: 1 })
  .limit(10)
  .select({ name: 1 })
  .plain();
// nothing has been sent to the database yet

const rows = await query;
//    ^?
// → [{ _id: "…", name: "Alice" }, { _id: "…", name: "Carol" }]
