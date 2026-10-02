import { Entity, Post, PostHookError, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;

  @Post("document.save")
  notify(this: Account): void {
    throw new Error("the hook failed");
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
try {
  await Accounts.create({ owner: "ann" });
} catch (error) {
  if (error instanceof PostHookError) {
    console.log(error.message);
    // → Account.create: a post hook failed after the write succeeded: the hook failed. The write IS applied (outside a transaction nothing rolls it back); do not repeat it — the hook's error is the cause
    console.log(error.model, error.operation, error.applied);
    // → "Account" "create" true
    console.log((error.cause as Error).message);
    // → "the hook failed"
  }
}
