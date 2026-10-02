import { Entity, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
// ---cut---
// @errors: 2353
  @Pre("query.find")
  wrong(this: OperationHookContext<Account, "query.find">): void {
    this.modify({ update: { $set: { title: "x" } } });
  }
}
