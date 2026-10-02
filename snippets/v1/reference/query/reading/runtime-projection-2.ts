import { Entity, type Hidden, Prop, Schema, TypemoClient, untrusted } from "@venloc/typemo";
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
export const listUsers = (fieldsFromRequest: Record<string, 0 | 1>) =>
  Users.find().select(untrusted(fieldsFromRequest, "projection")).plain();

const rows = await listUsers({ name: 1 });
//    ^?
// → [{ _id: "…", name: "Alice" }, { _id: "…", name: "Bob" }, { _id: "…", name: "Carol" }]
