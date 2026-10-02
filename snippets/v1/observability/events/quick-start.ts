import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
const Accounts = client.db().model(Account);
// ---cut---
const subscription = client.instrument({
  handle: (event) => {
    if (event.type === "operation.end") {
      console.log(`${event.model}.${event.operation}: ${event.documentCount} шт.`);
    }
  },
});

await Accounts.find({ balance: { $gt: 50 } }).plain();
// → "Account.find: 1 шт."

subscription.unsubscribe();
