import { Body, Controller, Get, Injectable, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Entity, type Model, Prop, Schema, Tenant, type TenantField } from "@venloc/typemo";
import {
  AllTenants,
  InjectModel,
  PolicyInterceptor,
  Transactional,
  TypemoExceptionFilter,
  TypemoModule,
} from "@venloc/typemo-nestjs";

// models
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}

@Schema({ collection: "orders", tenant: true })
export class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}

// a transfer in a transaction
@Injectable()
export class TransfersService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Transactional()
  async transfer(from: Account["_id"], to: Account["_id"], amount: number): Promise<void> {
    await this.accounts.updateOne({ _id: from }, { $inc: { balance: -amount } });
    await this.accounts.updateOne({ _id: to }, { $inc: { balance: amount } });
  }
}

// the orders of the organization from the request
@Controller("orders")
export class OrdersController {
  constructor(@InjectModel(Order) private readonly orders: Model<Order>) {}

  @Post()
  async create(@Body() body: { readonly number: string }) {
    return (await this.orders.create({ number: body.number })).$toPlain();
  }

  @Get()
  async list() {
    return (await this.orders.find().sort({ number: 1 }).plain()).map((order) => order.number);
  }

  @AllTenants()
  @Get("all")
  async all() {
    return (await this.orders.find().plain()).length;
  }
}

@Module({
  imports: [
    TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank", sync: "init" }),
    TypemoModule.forFeature([Account, Order]),
  ],
  controllers: [OrdersController],
  providers: [TransfersService],
})
export class AppModule {}

const app = await NestFactory.create(AppModule);
app.useGlobalFilters(new TypemoExceptionFilter());
app.useGlobalInterceptors(
  new PolicyInterceptor({
    tenant: (request) => request.headers["x-tenant"],
    actor: (request) => request.headers["x-user"],
  }),
);
await app.listen(3000);
