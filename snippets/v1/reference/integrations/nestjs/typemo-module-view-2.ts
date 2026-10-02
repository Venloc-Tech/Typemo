import { Entity, Prop, Schema } from "@venloc/typemo";
import { TypemoModule } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
@Schema({ collection: "open_accounts" })
class OpenAccount extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
// ---cut---
// @errors: 2322
TypemoModule.view(OpenAccount, {
  on: Account,
  pipeline: (p) => p.project({ title: 1 }),
});
