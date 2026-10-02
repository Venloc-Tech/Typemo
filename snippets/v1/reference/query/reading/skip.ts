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
const pageNumber = 2;
const perPage = 2;

const page = await Users.find()
  .sort({ name: 1 })
  .skip((pageNumber - 1) * perPage)
  .limit(perPage)
  .plain();
console.log(page.map((user) => user.name));
// → ["Carol"]
