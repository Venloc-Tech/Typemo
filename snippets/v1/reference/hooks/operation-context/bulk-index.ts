import { Entity, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
// ---cut---
  @Pre("query.updateOne")
  describe(this: OperationHookContext<Account, "query.updateOne">): void {
    console.log(this.bulkIndex, JSON.stringify(this.filter));
    // → 1 {"title":"Ups"}
  }
}
