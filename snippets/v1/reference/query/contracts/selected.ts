import { Contract, Entity, type Hidden, Prop, Schema, type Selected, type SelectedJson, type SelectedLean, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
type Row = Selected<User, "name" | "age">;
//   ^?

type WithoutId = Selected<User, "name" | "-_id">;
//   ^?
