import { Entity, type Hidden, Prop, type Projection, Schema, TypemoClient } from "@venloc/typemo";
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
const fields: Projection<User> = { name: 1, age: 1 };
const rows = await Users.find({ name: "Alice" }).select(fields).plain();
//    ^?
// → [{ _id: "…", name: "Alice", age: 30 }]
