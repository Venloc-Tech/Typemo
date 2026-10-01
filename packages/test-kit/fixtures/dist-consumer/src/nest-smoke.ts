/*
 * The NestJS smoke: the compiled JavaScript of this file runs under Node against the BUILT `@venloc/typemo-nestjs`, a
 * real Nest 12 application on Express and a real MongoDB (`MONGO_URI`). It prints one JSON object of results.
 * Nest's class injection is given explicit tokens (`@Inject(Bank)`): this consumer compiles without
 * `emitDecoratorMetadata`, as the core recommends.
 */
import { Body, Controller, Get, Inject, Injectable, Module, Param, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type CreateInput, Entity, type IdOf, type Model, Prop, Schema } from "@venloc/typemo";
import {
  InjectModel,
  ParseIdPipe,
  PolicyInterceptor,
  Transactional,
  TypemoExceptionFilter,
  TypemoModule,
  ValidateBodyPipe,
} from "@venloc/typemo-nestjs";

@Schema({ collection: "nest_wallets" })
class Wallet extends Entity {
  @Prop(() => String, { required: true, unique: true })
  owner!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;
}

@Injectable()
class Bank {
  constructor(@InjectModel(Wallet) readonly wallets: Model<Wallet>) {}

  @Transactional()
  async openPair(owner: string): Promise<number> {
    await this.wallets.create({ owner, balance: 1 });
    await this.wallets.create({ owner: `${owner}-2`, balance: 2 });
    return this.wallets.countDocuments({ balance: { $gte: 0 } });
  }
}

@Controller("wallets")
class WalletsController {
  constructor(
    @Inject(Bank) private readonly bank: Bank,
    @InjectModel(Wallet) private readonly wallets: Model<Wallet>,
  ) {}

  @Post()
  async create(@Body(ValidateBodyPipe.for(Wallet)) body: CreateInput<Wallet>) {
    return (await this.wallets.create(body)).$toPlain();
  }

  @Get(":id")
  get(@Param("id", ParseIdPipe.for(Wallet)) id: IdOf<Wallet>) {
    return this.wallets.findById(id).orFail().plain();
  }

  @Post("pair/:owner")
  async pair(@Param("owner") owner: string) {
    return { count: await this.bank.openPair(owner) };
  }
}

const uri = process.env.MONGO_URI;
if (uri === undefined) throw new Error("MONGO_URI is not set");

@Module({
  imports: [
    TypemoModule.forRoot(uri, { dbName: process.env.MONGO_DB ?? "dist_consumer_nest", sync: "init", retryAttempts: 1 }),
    TypemoModule.forFeature([Wallet]),
  ],
  controllers: [WalletsController],
  providers: [Bank],
})
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
app.useGlobalFilters(new TypemoExceptionFilter());
app.useGlobalInterceptors(new PolicyInterceptor({ tenant: () => undefined }));
await app.listen(0, "127.0.0.1");
const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};
const out: Record<string, unknown> = {};
try {
  const created = await call("POST", "/wallets", { owner: "ann", balance: 5 });
  out.created = [created.status, created.body.owner];
  out.read = (await call("GET", `/wallets/${created.body._id as string}`)).body.balance;
  out.badId = (await call("GET", "/wallets/nope")).status;
  out.invalid = (await call("POST", "/wallets", { owner: "bob", balance: -1 })).body.errors;
  out.duplicate = (await call("POST", "/wallets", { owner: "ann", balance: 1 })).body.fields;
  out.transaction = (await call("POST", "/wallets/pair/cy")).body.count;
} finally {
  await app.close();
}
console.log(`RESULT ${JSON.stringify(out)}`);
