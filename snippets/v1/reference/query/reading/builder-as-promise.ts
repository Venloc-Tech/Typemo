import { Entity, type HydratedDoc, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
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
export const getUser = (id: string): Promise<HydratedDoc<User>> => Users.findById(id).orFail();

const alice = await Users.findOne({ name: "Alice" }).orFail();
const loaded = await getUser(String(alice._id));
console.log(loaded.name);
// → "Alice"
