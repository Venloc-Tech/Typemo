import { Entity, Post, PostError, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";
const log: string[] = [];
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Pre("document.save") second(this: Account): void {
    log.push("pre 2");
    if (this.title === "forbidden") throw new Error("pre 2 failed");
  }
  @Pre("document.save") third(this: Account): void { log.push("pre 3"); }
  @Post("document.save") after(this: Account): void { log.push("post"); }
  @PostError("document.save") failed(this: Account, error: unknown): void {
    log.push(`postError ${error instanceof Error ? error.message : String(error)}`);
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
await Accounts.create({ title: "forbidden" }).catch((error: Error) => console.log(error.message));
// → pre 2 failed
console.log(log);
// → ["pre 2", "postError pre 2 failed"]
