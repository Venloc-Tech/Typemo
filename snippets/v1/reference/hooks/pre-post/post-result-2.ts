import { Entity, Post, Schema, type OperationHookContext } from "@venloc/typemo";
// ---cut---
// @errors: 1241
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Post("query.countDocuments")
  counted(this: OperationHookContext<Account>, result: string): void {}
}
