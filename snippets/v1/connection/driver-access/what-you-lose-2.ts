import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", softDelete: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
const raw = client.unsafeDriver().db("app").collection("accounts");
// ---cut---
await Accounts.deleteOne({ title: "Main" });
console.log(await Accounts.countDocuments(), await raw.countDocuments());
// → 0 1
