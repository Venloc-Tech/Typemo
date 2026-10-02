import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", validator: true })
class Account extends Entity {
  @Prop(() => String, { required: true, minLength: 2 }) title!: string;
  @Prop(() => Number, { min: 0 }) balance?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.connection.model(Account);
await Accounts.createCollection();
// ---cut---
const raw = client.unsafeDriver().db("app").collection("accounts");
try {
  await raw.insertOne({ title: "x" });
} catch (error) {
  console.log((error as Error).name, (error as Error).message);
  // → "MongoServerError" "Document failed validation"
}
