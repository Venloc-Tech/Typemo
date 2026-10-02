import { Entity, type Defaulted, JsonSchemaGenerator, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users", validator: true })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true, lowercase: true, minLength: 3 })
  name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" })
  role!: Defaulted<"user" | "admin">;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
console.log(JsonSchemaGenerator.generate(Users).required);
// → ["_id", "name"]
const { validationLevel, validationAction } = JsonSchemaGenerator.validator(Users);
console.log(validationLevel, validationAction);
// → strict error
