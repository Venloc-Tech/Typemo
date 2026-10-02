import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
const Accounts = client.connection.model(Account);
const viaModel = await Accounts.findOne({ owner: "alice" }).plain();
//    ^?
const viaDriver = await client.unsafeDriver().db("app").collection("accounts").findOne({ owner: "alice" });
//    ^?
