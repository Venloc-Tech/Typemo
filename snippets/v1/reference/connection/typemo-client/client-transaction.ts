import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.connection.model(Account);
// ---cut---
const attempt = await client.transaction(async (scope) => {
  await Accounts.create({ title: "Savings", owner: "alice" });
  return scope.attempt;
});
console.log(attempt);
// → 1
