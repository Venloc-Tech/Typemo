// The demo's feature module: a service with a transaction, a controller with the pipes.
import { Body, Controller, Get, Injectable, Module, Param, Post } from "@nestjs/common";
import type { CreateInput, IdOf, Model } from "@venloc/typemo";
import { AllTenants, InjectModel, ParseIdPipe, Transactional, TypemoModule, ValidateBodyPipe } from "../src/index.ts";
import { Account, Customer, SavingsAccount } from "./entities.ts";

@Injectable()
export class BankService {
  constructor(
    @InjectModel(Account) private readonly accounts: Model<Account>,
    @InjectModel(SavingsAccount) private readonly savings: Model<SavingsAccount>,
  ) {}

  open(body: CreateInput<Account>) {
    return this.accounts.create(body);
  }

  openSavings(title: string, rate: number) {
    return this.savings.create({ title, rate, balance: 0 });
  }

  @Transactional()
  async transfer(from: IdOf<Account>, to: IdOf<Account>, amount: number): Promise<void> {
    await this.accounts.updateOne({ _id: from }, { $inc: { balance: -amount } });
    const source = await this.accounts.findById(from).orFail().lean();
    if (source.balance < 0) throw new Error("not enough money");
    await this.accounts.updateOne({ _id: to }, { $inc: { balance: amount } });
  }
}

@Controller("accounts")
export class AccountsController {
  constructor(
    private readonly bank: BankService,
    @InjectModel(Account) private readonly accounts: Model<Account>,
  ) {}

  @Post()
  async open(@Body(ValidateBodyPipe.for(Account, { omit: ["tenantId"] })) body: CreateInput<Account>) {
    return (await this.bank.open(body)).$toPlain();
  }

  @Post("savings")
  async openSavings(@Body() body: { readonly title: string; readonly rate: number }) {
    return (await this.bank.openSavings(body.title, body.rate)).$toPlain();
  }

  @Get(":id")
  get(@Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>) {
    return this.accounts.findById(id).populate("owner").orFail().plain();
  }

  @Get()
  list() {
    return this.accounts
      .find({ balance: { $gte: 0 } })
      .sort({ title: 1 })
      .plain();
  }

  @Post("transfer")
  async transfer(@Body() body: { readonly from: string; readonly to: string; readonly amount: number }) {
    const parse = new ParseIdPipe(this.accounts);
    await this.bank.transfer(parse.transform(body.from), parse.transform(body.to), body.amount);
    return { ok: true };
  }

  @AllTenants()
  @Get("admin/count")
  async count() {
    return { accounts: await this.accounts.countDocuments({ balance: { $gte: 0 } }) };
  }
}

@Controller("customers")
export class CustomersController {
  constructor(@InjectModel(Customer) private readonly customers: Model<Customer>) {}

  @Post()
  async create(@Body(ValidateBodyPipe.for(Customer)) body: CreateInput<Customer>) {
    return (await this.customers.create(body)).$toPlain();
  }
}

@Module({
  imports: [TypemoModule.forFeature([Customer, Account, SavingsAccount])],
  controllers: [AccountsController, CustomersController],
  providers: [BankService],
})
export class BankModule {}
