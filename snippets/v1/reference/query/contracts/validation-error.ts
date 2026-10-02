import { Contract, Entity, type Hidden, Prop, Schema, type Selected, type SelectedJson, type SelectedLean, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
declare const nameRow: { "~standard": { version: 1; vendor: string; validate: (value: unknown) => { value: { name: string } } | { issues: { message: string; path: string[] }[] }; types: { input: unknown; output: { name: string } } } };
// ---cut---
try {
  await Users.find().sort({ name: 1 }).lean().parse(nameRow);
} catch (error) {
  console.log(String(error));
  // → 'ValidationError: Validation failed: "1.name": row 1: name is too short [schema]'
}
