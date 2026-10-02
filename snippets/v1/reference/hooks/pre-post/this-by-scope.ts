import { Entity, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";
// ---cut---
// @errors: 1241
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Pre("query.find")
  wrong(this: Account): void {}
}
