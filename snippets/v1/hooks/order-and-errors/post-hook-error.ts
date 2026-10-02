import { Entity, Post, PostError, PostHookError, Prop, Schema, TypemoClient } from "@venloc/typemo";
const log: string[] = [];
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Post("document.save") after(this: Account): void {
    log.push("post");
    throw new Error("post failed");
  }
  @PostError("document.save") failed(this: Account): void { log.push("postError"); }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
try {
  await Accounts.create({ title: "Main" });
} catch (error) {
  if (error instanceof PostHookError) {
    console.log(error.applied, error.operation, (error.cause as Error).message);
    // → true create post failed
  }
}
console.log(log, await Accounts.countDocuments());
// → ["post"] 1
