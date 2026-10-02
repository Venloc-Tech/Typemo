import { DocumentNotFoundError, Entity, Prop, Schema, TypemoClient, Versioned } from "@venloc/typemo";
@Schema({ collection: "accounts", optimisticConcurrency: true })
class Account extends Versioned(Entity) {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
try {
  await Accounts.findOne({ title: "no such account" }).orFail();
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    console.log(error.message);
    // → Account.findOne: no document matched the filter (orFail)
    console.log(error.operation, error.model);
    // → "findOne" "Account"
  }
}
