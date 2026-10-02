import { type Defaulted, Entity, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { default: 0 }) balance!: Defaulted<number>;
// ---cut---
  @Pre("query.updateOne")
  describe(this: OperationHookContext<Account, "query.updateOne">): void {
    console.log(this.event, this.operation, this.model, this.filter, this.update);
    // → query.updateOne updateOne Account { title: "a" } { $inc: { balance: 5 } }
  }
}
