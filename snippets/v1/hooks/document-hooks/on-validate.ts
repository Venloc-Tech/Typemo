import { Entity, Post, PostError, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, minLength: 3 }) title!: string;

  @Pre("document.validate")
  beforeValidate(this: Account): void {
    console.log("validation started");
  }

  @PostError("document.validate")
  validationFailed(this: Account, error: unknown): void {
    console.log("validation failed:", error instanceof Error ? error.name : error);
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
await Accounts.create({ title: "ab" }).catch(() => undefined);
// → validation started
// → validation failed: ValidationError
