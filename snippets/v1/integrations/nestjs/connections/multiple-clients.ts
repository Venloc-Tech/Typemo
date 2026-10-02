import { Injectable, Module } from "@nestjs/common";
import { Entity, type Model, Prop, Schema, type TypemoClient } from "@venloc/typemo";
import { InjectClient, InjectModel, TypemoModule } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
// ---cut---
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Account) private readonly accounts: Model<Account>,
    @InjectModel(Account, { client: "analytics" }) private readonly copies: Model<Account>,
    @InjectClient("analytics") private readonly analytics: TypemoClient,
  ) {}
}

@Module({
  imports: [TypemoModule.forFeature([Account]), TypemoModule.forFeature([Account], { client: "analytics" })],
  providers: [ReportsService],
})
export class ReportsModule {}
