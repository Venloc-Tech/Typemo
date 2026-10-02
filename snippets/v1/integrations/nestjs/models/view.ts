import { Injectable, Module } from "@nestjs/common";
import { Entity, Prop, Schema, type TypedView } from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
// ---cut---
@Schema({ collection: "funded_accounts" })
export class FundedAccount extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

const funded = TypemoModule.view(FundedAccount, {
  on: Account,
  pipeline: (p) => p.match({ balance: { $gt: 0 } }).project({ title: 1, balance: 1 }),
});

@Injectable()
export class FundedService {
  constructor(@InjectModel(FundedAccount) private readonly funded: TypedView<FundedAccount>) {}

  titles() {
    return this.funded.find({}).then((rows) => rows.map((row) => row.title));
  }
}

@Module({ imports: [TypemoModule.forFeature([Account, funded])], providers: [FundedService] })
export class AccountsModule {}
