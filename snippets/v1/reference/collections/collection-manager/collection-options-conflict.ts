import { CollectionOptionsError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", validator: true })
class Account extends Entity {
  @Prop(() => String, { required: true, minLength: 2 }) title!: string;
  @Prop(() => Number, { min: 0 }) balance?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.connection.model(Account);
await client.unsafeDriver().db("app").createCollection("accounts");
// ---cut---
try {
  await Accounts.createCollection();
} catch (error) {
  if (error instanceof CollectionOptionsError) {
    console.log(error.collection, error.differences.map((d) => [d.option, d.mutable]));
    // → "accounts" [["validator", true]]
  }
}
