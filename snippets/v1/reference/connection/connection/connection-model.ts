import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
// ---cut---
const Accounts = connection.model(Account);
console.log(Accounts === connection.model(Account));
// → true
