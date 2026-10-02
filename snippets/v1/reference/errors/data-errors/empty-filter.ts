import { Entity, Prop, Schema, TypemoClient, StrictModeError } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const filter = JSON.parse("{}");

try {
  await Accounts.deleteMany(filter);
} catch (error) {
  if (error instanceof StrictModeError) console.log(error.message);
  // → deleteMany with an empty filter would affect every document; pass a filter, or Filters.all() to mean every document on purpose [empty-filter]
}
