import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
// ---cut---
const client = await TypemoClient.connect("mongodb://localhost:27017/app", { validateReads: true });
const Accounts = client.connection.model(Account);
await client.unsafeDriver().db("app").collection("accounts").insertOne({ title: 5, owner: "bob" });

try {
  await Accounts.findOne({ owner: "bob" });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string failed at path "title" for 5 (number): the stored value does not match the schema of Account (a document read from the database, checked by validateReads) [type]
