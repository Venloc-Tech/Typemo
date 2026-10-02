import { Entity, JsonSchemaGenerator, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, minLength: 2 }) name!: string;
}
const Users = client.db().model(User);
const fromModel = JsonSchemaGenerator.generate(Users); // [!code highlight]
const fromSchema = JsonSchemaGenerator.generate(Users.schema); // [!code highlight]
console.log(JSON.stringify(fromModel) === JSON.stringify(fromSchema), fromModel.required);
// → true ["_id", "name"]
