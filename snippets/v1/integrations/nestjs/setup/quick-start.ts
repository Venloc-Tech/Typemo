import { Controller, Get, Injectable, Module } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

@Injectable()
export class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  list() {
    return this.accounts.find().plain();
  }
}

@Controller("accounts")
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Get()
  list() {
    return this.service.list();
  }
}

@Module({
  imports: [
    TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank" }),
    TypemoModule.forFeature([Account]),
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AppModule {}
