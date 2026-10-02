import { Injectable, Module } from "@nestjs/common";
import { Entity, EntityWithId, fn, type Materialized, Prop, Schema } from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
// ---cut---
@Schema({ collection: "title_totals" })
export class TitleTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) total!: number;
}

const totals = TypemoModule.materialized(TitleTotal, {
  from: Account,
  pipeline: (p) => p.match({ balance: { $gt: 0 } }).group((f) => ({ _id: f.title, total: fn.sum(f.balance) })),
  mode: "replace",
});

@Injectable()
export class TotalsService {
  constructor(@InjectModel(TitleTotal) private readonly totals: Materialized<TitleTotal>) {}

  async rebuild() {
    await this.totals.refresh();
    return this.totals.model.find({}).lean();
  }
}

@Module({ imports: [TypemoModule.forFeature([Account, totals])], providers: [TotalsService] })
export class ReportsModule {}
