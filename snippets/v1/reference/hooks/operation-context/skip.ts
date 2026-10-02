import { type Defaulted, Entity, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";
declare const dryRun: boolean;
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { default: 0 }) balance!: Defaulted<number>;
// ---cut---
  @Pre("query.deleteMany")
  dryRunOnly(this: OperationHookContext<Account, "query.deleteMany">): void {
    if (dryRun) this.skip({ acknowledged: true, deletedCount: 0 });
  }
}
