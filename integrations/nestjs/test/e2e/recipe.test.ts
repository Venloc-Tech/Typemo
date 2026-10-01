// The application of the recipe docs/ru/v1/recipes/nestjs-rest-api.mdx, with the requests and answers the page shows.
// If an answer changes here, change the page.
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  type INestApplication,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  type CreateInput,
  type Defaulted,
  Entity,
  type IdOf,
  type Model,
  Prop,
  Schema,
  Tenant,
  type TenantField,
  type UpdateInput,
} from "@venloc/typemo";
import {
  InjectModel,
  ParseIdPipe,
  PolicyInterceptor,
  Transactional,
  TypemoExceptionFilter,
  TypemoModule,
  ValidateBodyPipe,
} from "../../src/index.ts";
import { TypemoTestingModule } from "../../src/testing/index.ts";
import { NestTest } from "../support/nest-test.ts";

// accounts/account.ts
@Schema({ collection: "recipe_accounts", tenant: true })
export class Account extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;

  @Prop(() => String, { required: true, minLength: 1 })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;

  @Prop(() => String, { enum: ["open", "closed"] as const, default: "open" })
  status!: Defaulted<"open" | "closed">;
}

const STATUSES = ["open", "closed"] as const;

// accounts/accounts.service.ts
@Injectable()
export class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  list(status: "open" | "closed" | undefined, limit: number) {
    return this.accounts
      .find(status === undefined ? {} : { status })
      .sort({ title: 1 })
      .limit(limit)
      .select({ title: 1, balance: 1, status: 1 })
      .plain();
  }

  get(id: IdOf<Account>) {
    return this.accounts.findById(id).orFail().plain();
  }

  async open(body: CreateInput<Account>) {
    return (await this.accounts.create(body)).$toPlain();
  }

  update(id: IdOf<Account>, body: UpdateInput<Account>) {
    return this.accounts.findByIdAndUpdate(id, { $set: body }).orFail().plain();
  }

  async close(id: IdOf<Account>): Promise<void> {
    await this.accounts.updateOne({ _id: id }, { $set: { status: "closed" } });
  }

  @Transactional()
  async transfer(from: IdOf<Account>, to: IdOf<Account>, amount: number): Promise<void> {
    await this.accounts.findOneAndUpdate({ _id: from, status: "open" }, { $inc: { balance: -amount } }).orFail();
    await this.accounts.findOneAndUpdate({ _id: to, status: "open" }, { $inc: { balance: amount } }).orFail();
  }
}

// accounts/accounts.controller.ts
@Controller("accounts")
export class AccountsController {
  constructor(
    private readonly service: AccountsService,
    @InjectModel(Account) private readonly accounts: Model<Account>,
  ) {}

  @Get()
  list(@Query("status") status?: string, @Query("limit") limit = "20") {
    if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(`status is one of ${STATUSES.join(", ")}`);
    }
    const count = Number(limit);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new BadRequestException("limit is 1 to 100");
    return this.service.list(status as "open" | "closed" | undefined, count);
  }

  @Get(":id")
  get(@Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>) {
    return this.service.get(id);
  }

  @Post()
  open(@Body(ValidateBodyPipe.for(Account, { pick: ["title", "balance"] })) body: CreateInput<Account>) {
    return this.service.open(body);
  }

  @Patch(":id")
  update(
    @Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>,
    @Body(ValidateBodyPipe.for(Account, { pick: ["title"], partial: true })) body: UpdateInput<Account>,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  close(@Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>) {
    return this.service.close(id);
  }

  @Post("transfer")
  @HttpCode(204)
  transfer(@Body() body: { readonly from: string; readonly to: string; readonly amount: number }) {
    if (typeof body.amount !== "number" || !(body.amount > 0)) throw new BadRequestException("amount is positive");
    const ids = new ParseIdPipe(this.accounts);
    return this.service.transfer(ids.transform(body.from), ids.transform(body.to), body.amount);
  }
}

// accounts/accounts.module.ts
@Module({
  imports: [TypemoModule.forFeature([Account])],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}

let app: INestApplication;
let url = "";
const call = async (method: string, path: string, body?: unknown, org = "acme") => {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-org": org },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [TypemoTestingModule.forRoot(await NestTest.uri()), AccountsModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new TypemoExceptionFilter());
  app.useGlobalInterceptors(new PolicyInterceptor({ tenant: (request) => request.headers["x-org"] }));
  await app.listen(0, "127.0.0.1");
  url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
afterAll(() => app.close());

test("the recipe's requests give the answers the page shows", async () => {
  const main = await call("POST", "/accounts", { title: "Main", balance: 100 });
  expect(main.status).toBe(201);
  expect(Object.keys(main.body as object).sort()).toEqual(["_id", "balance", "status", "tenantId", "title"]);
  expect(main.body).toMatchObject({ title: "Main", balance: 100, status: "open", tenantId: "acme" });
  const savings = await call("POST", "/accounts", { title: "Savings", balance: 0 });
  const mainId = (main.body as { _id: string })._id;
  const savingsId = (savings.body as { _id: string })._id;

  expect((await call("POST", "/accounts", { title: "Hack", balance: 1, tenantId: "globex" })).body).toEqual({
    statusCode: 422,
    error: "Unprocessable Entity",
    message: "Validation failed",
    errors: { tenantId: "not allowed here" },
  });

  expect((await call("POST", "/accounts/transfer", { from: mainId, to: savingsId, amount: 30 })).status).toBe(204);
  expect((await call("GET", "/accounts")).body).toEqual([
    { _id: mainId, title: "Main", balance: 70, status: "open" },
    { _id: savingsId, title: "Savings", balance: 30, status: "open" },
  ]);

  expect((await call("POST", "/accounts/transfer", { from: savingsId, to: mainId, amount: 500 })).body).toEqual({
    statusCode: 422,
    error: "Unprocessable Entity",
    message: "Validation failed",
    errors: { balance: "$inc -500 on 30 gives -470, below the minimum 0; nothing was written" },
  });
  expect(((await call("GET", `/accounts/${savingsId}`)).body as { balance: number }).balance).toBe(30);

  expect((await call("PATCH", `/accounts/${mainId}`, { title: "Everyday" })).body).toMatchObject({ title: "Everyday" });
  expect((await call("PATCH", `/accounts/${mainId}`, { balance: 1_000_000 })).body).toEqual({
    statusCode: 422,
    error: "Unprocessable Entity",
    message: "Validation failed",
    errors: { balance: "not allowed here" },
  });

  expect((await call("DELETE", `/accounts/${savingsId}`)).status).toBe(204);
  expect((await call("GET", "/accounts?status=closed")).body).toEqual([
    { _id: savingsId, title: "Savings", balance: 30, status: "closed" },
  ]);
  expect((await call("POST", "/accounts/transfer", { from: mainId, to: savingsId, amount: 1 })).body).toEqual({
    statusCode: 404,
    error: "Not Found",
    message: "Not found",
  });
  expect(((await call("GET", `/accounts/${mainId}`)).body as { balance: number }).balance).toBe(70);

  expect((await call("GET", "/accounts", undefined, "globex")).body).toEqual([]);
  expect((await call("GET", `/accounts/${mainId}`, undefined, "globex")).status).toBe(404);
  expect((await call("GET", "/accounts/12")).body).toEqual({
    statusCode: 400,
    error: "Bad Request",
    message: "Invalid id: expected ObjectId (not a 24-character hex string)",
  });
  expect((await call("GET", "/accounts?status=frozen")).body).toEqual({
    statusCode: 400,
    error: "Bad Request",
    message: "status is one of open, closed",
  });
});
