import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
connection.model(Account);
// ---cut---
console.log(connection.models.map((model) => model.modelName));
// → ["Account"]
