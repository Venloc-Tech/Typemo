import { type Defaulted, Entity, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";
// ---cut---
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { default: 0 })
  balance!: Defaulted<number>;

  @Pre("query.updateMany")
  bumpRevision(this: OperationHookContext<Account, "query.updateMany">): void {
    this.modify({ update: { $inc: { balance: 1 } } });
  }
}
