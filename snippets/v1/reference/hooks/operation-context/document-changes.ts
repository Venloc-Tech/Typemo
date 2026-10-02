import { type Defaulted, Entity, type HookThis, Pre, Prop, Schema } from "@venloc/typemo";
// ---cut---
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { default: 0 })
  balance!: Defaulted<number>;

  @Pre("document.save")
  logChanges(this: HookThis<"document.save", Account>): void {
    if (!this.$isRoot()) return;
    console.log(this.$isNew(), this.$getChanges());
    // → false { $set: { balance: 5 } }
  }
}
