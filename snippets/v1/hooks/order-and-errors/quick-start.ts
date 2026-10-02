import { Entity, Post, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";
const log: string[] = [];
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Pre("document.save") async first(this: Account): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 30)); log.push("pre 1 (async)"); }
  @Pre("document.save") second(this: Account): void { log.push("pre 2"); }
  @Pre("document.save") third(this: Account): void { log.push("pre 3"); }
  @Post("document.save") after(this: Account): void { log.push("post"); }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
await Accounts.create({ title: "Main" });
console.log(log);
// → ["pre 1 (async)", "pre 2", "pre 3", "post"]
