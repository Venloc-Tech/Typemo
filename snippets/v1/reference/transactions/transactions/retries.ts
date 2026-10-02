import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// ---cut---
const runs: string[] = [];
const bump = (name: string) =>
  client.transaction(async (scope) => {
    runs.push(`${name}${scope.attempt}`);
    await Accounts.updateOne({ title: "Main" }, { $inc: { balance: 1 } });
    await sleep(150);
  });

await Promise.all([bump("A"), bump("B")]);
console.log(runs.slice(0, 2), runs.length > 2);
// → ["A1", "B1"] true
