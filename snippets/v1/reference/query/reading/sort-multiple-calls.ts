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
const sorted = await Users.find().sort({ age: -1 }).sort({ name: -1 }).plain();
// same as .sort({ age: -1, name: -1 })
console.log(sorted.map((user) => user.name));
// → ["Carol", "Alice", "Bob"]
