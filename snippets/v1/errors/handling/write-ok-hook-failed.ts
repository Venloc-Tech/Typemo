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
  if (error instanceof PostHookError) console.log(error.applied, (error.cause as Error).message);
  // → true "the hook failed"
}
