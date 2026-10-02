import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
const raw = client.unsafeDriver().db("app").collection("accounts");
// ---cut---
await raw.insertOne({ title: 5, owner: "bob" });

console.log(await Accounts.find({ owner: "bob" }).plain());
// → [{ _id: "…", title: 5, owner: "bob" }]

try {
  await Accounts.find({ owner: "bob" }).validateReads().plain();
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string failed at path "title" for 5 (number): the stored value does not match the schema of Account (a document read from the database, checked by validateReads) [type]
