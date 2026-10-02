import { Body, Controller, Get, Injectable, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type CreateInput, Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, TypemoExceptionFilter, TypemoModule, ValidateBodyPipe } from "@venloc/typemo-nestjs";

// model
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;
}

// service: data access
@Injectable()
export class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  async open(body: CreateInput<Account>) {
    return (await this.accounts.create(body)).$toPlain();
  }

  list() {
    return this.accounts.find().sort({ title: 1 }).plain();
  }
}

// controller: HTTP
@Controller("accounts")
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Post()
  open(@Body(ValidateBodyPipe.for(Account)) body: CreateInput<Account>) {
    return this.service.open(body);
  }

  @Get()
  list() {
    return this.service.list();
  }
}

// the accounts module and the root module
@Module({
  imports: [TypemoModule.forFeature([Account])],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}

@Module({ imports: [TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank" }), AccountsModule] })
export class AppModule {}

// startup
const app = await NestFactory.create(AppModule);
app.useGlobalFilters(new TypemoExceptionFilter());
app.enableShutdownHooks();
await app.listen(3000);
