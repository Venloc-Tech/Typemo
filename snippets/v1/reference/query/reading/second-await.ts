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
const query = Users.find().plain();

const first = await query; // → 3 users
await Users.create({ name: "Dave", tags: [] });
const second = await query; // → the same 3 users, the same array
console.log(first === second);
// → true

const fresh = await query.exec({ force: true });
// → 4 users
