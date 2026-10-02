import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String) status?: string;
}
// ---cut---
const client = await TypemoClient.connect("mongodb://localhost:27017/bank", { validateReads: "development" });
const Accounts = client.connection.model(Account);
await client.unsafeDriver().db("bank").collection("accounts").insertOne({ owner: "ann", balance: "12" });

try {
  await Accounts.find({ owner: "ann" }).plain();
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to number failed at path "balance" for "12" (string): the stored value does not match the schema of Account (a document read from the database, checked by validateReads) [type]
