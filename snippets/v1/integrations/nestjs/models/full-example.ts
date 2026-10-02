import { Injectable, Module } from "@nestjs/common";
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  EntityWithId,
  fn,
  type Materialized,
  type Model,
  Prop,
  Schema,
  type TypedView,
} from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";

// entities
@Schema({ collection: "accounts" })
export class Account extends Entity {
  declare readonly __t?: DiscriminatorValue<"savings">;
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}

@Discriminator("savings")
export class SavingsAccount extends Account {
  declare readonly __t: DiscriminatorValue<"savings">;
  @Prop(() => Number, { required: true }) rate!: number;
}

// view and summary
@Schema({ collection: "funded_accounts" })
export class FundedAccount extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const funded = TypemoModule.view(FundedAccount, {
  on: Account,
  pipeline: (p) => p.match({ balance: { $gt: 0 } }).project({ title: 1, balance: 1 }),
});

@Schema({ collection: "title_totals" })
export class TitleTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) total!: number;
}
const totals = TypemoModule.materialized(TitleTotal, {
  from: Account,
  pipeline: (p) => p.group((f) => ({ _id: f.title, total: fn.sum(f.balance) })),
  mode: "replace",
});

// service
@Injectable()
export class AccountsService {
  constructor(
    @InjectModel(Account) private readonly accounts: Model<Account>,
    @InjectModel(SavingsAccount) private readonly savings: Model<SavingsAccount>,
    @InjectModel(FundedAccount) private readonly funded: TypedView<FundedAccount>,
    @InjectModel(TitleTotal) private readonly totals: Materialized<TitleTotal>,
  ) {}

  openSavings(title: string, rate: number) {
    return this.savings.create({ title, rate, balance: 0 });
  }

  fundedTitles() {
    return this.funded.find({}).then((rows) => rows.map((row) => row.title));
  }

  refreshTotals() {
    return this.totals.refresh();
  }
}

// modules
@Module({
  imports: [TypemoModule.forFeature([Account, SavingsAccount, funded, totals])],
  providers: [AccountsService],
})
export class AccountsModule {}

@Module({
  imports: [TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank", sync: "init" }), AccountsModule],
})
export class AppModule {}
