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
export const getUserName = async (idFromUrl: string): Promise<string | undefined> => {
  const user = await Users.findById(idFromUrl).plain();
  return user?.name;
};

const alice = await Users.findOne({ name: "Alice" }).plain().orFail();
console.log(await getUserName(alice._id)); // _id in the .plain() result is already a string
// → "Alice"
