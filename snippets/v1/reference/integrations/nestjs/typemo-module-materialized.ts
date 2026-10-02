import { Entity, EntityWithId, fn, Prop, Schema } from "@venloc/typemo";
import { TypemoModule } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
// ---cut---
@Schema({ collection: "title_totals" })
class TitleTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) total!: number;
}

const totals = TypemoModule.materialized(TitleTotal, {
  from: Account,
  pipeline: (p) => p.match({ balance: { $gt: 0 } }).group((f) => ({ _id: f.title, total: fn.sum(f.balance) })),
  mode: "replace",
});
const imports = [TypemoModule.forFeature([Account, totals])];
