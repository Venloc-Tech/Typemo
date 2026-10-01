// The application of the Express e2e tests: controllers over the entities of the fixtures, with the exception filter,
// the policy interceptor, the pipes and @Transactional on a route handler.
import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from "@nestjs/common";
import {
  Post as AfterHook,
  type CreateInput,
  Entity,
  type HydratedDoc,
  type IdOf,
  type Model,
  PolicyContext,
  Prop,
  Schema,
  type Subdocument,
  type TypemoClient,
  type UpdateInput,
} from "@venloc/typemo";
import { from, type Observable } from "rxjs";
import {
  AllTenants,
  InjectClient,
  InjectModel,
  ParseIdPipe,
  Transactional,
  TypemoModule,
  ValidateBodyPipe,
} from "../../src/index.ts";
import { NtAccount, NtCountry, NtOrder, NtSession, NtTicket, NtUser } from "../fixtures/entities.ts";

@Schema({ collection: "nt_journal" })
export class NtJournal extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @AfterHook("document.save")
  explode(this: HydratedDoc<NtJournal> | Subdocument<NtJournal>): void {
    if (this.title === "explode") throw new Error("the hook after the save failed");
  }
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(NtUser) readonly users: Model<NtUser>) {}

  create(body: CreateInput<NtUser>) {
    return this.users.create(body);
  }
}

@Controller("users")
export class UsersController {
  constructor(
    private readonly service: UsersService,
    @InjectModel(NtUser) private readonly users: Model<NtUser>,
    @InjectClient() private readonly client: TypemoClient,
  ) {}

  @Post()
  async create(@Body(ValidateBodyPipe.for(NtUser)) body: CreateInput<NtUser>) {
    return (await this.service.create(body)).$toPlain();
  }

  @Post("strict-role")
  async createWithoutRole(@Body(ValidateBodyPipe.for(NtUser, { omit: ["role"] })) body: CreateInput<NtUser>) {
    return (await this.service.create(body)).$toPlain();
  }

  @Post("lenient")
  async createLenient(@Body(ValidateBodyPipe.for(NtUser, { dropUnknown: true })) body: CreateInput<NtUser>) {
    return (await this.service.create(body)).$toPlain();
  }

  @Post("names")
  names(@Body(ValidateBodyPipe.for(NtUser, { pick: ["name", "email"] })) body: CreateInput<NtUser>) {
    return body;
  }

  @Patch(":id")
  async rename(
    @Param("id", ParseIdPipe.for(NtUser)) id: IdOf<NtUser>,
    @Body(ValidateBodyPipe.for(NtUser, { partial: true })) body: UpdateInput<NtUser>,
  ) {
    return this.users.findByIdAndUpdate(id, { $set: body }).orFail().plain();
  }

  @Get(":id")
  get(@Param("id", ParseIdPipe.for(NtUser)) id: IdOf<NtUser>) {
    return this.users.findById(id).orFail().plain();
  }

  @Get()
  list(@Query("age") age?: string) {
    // A string for a number field: the core's cast error, on purpose.
    return this.users.find(age === undefined ? {} : { age: age as never }).plain();
  }

  @Get("by/unknown")
  byUnknown() {
    return this.users.find({ nickname: "x" } as never).plain();
  }

  @Post("raw-duplicate")
  async rawDuplicate() {
    const raw = this.client.unsafeDriver().db(this.users.connection.name).collection("nt_raw");
    await raw.insertOne({ _id: "same" as never });
    await raw.insertOne({ _id: "same" as never });
  }

  @Post("raw-other")
  async rawOther() {
    await this.client.unsafeDriver().db(this.users.connection.name).command({ thisCommandDoesNotExist: 1 });
  }

  @Get("slow/:ms")
  slow(@Param("ms") ms: string) {
    return this.users.find({}).timeoutMS(Number(ms)).plain();
  }
}

@Controller("ids")
export class IdsController {
  @Get("country/:id")
  country(@Param("id", ParseIdPipe.for(NtCountry)) id: IdOf<NtCountry>) {
    return { id, type: typeof id };
  }

  @Get("ticket/:id")
  ticket(@Param("id", ParseIdPipe.for(NtTicket)) id: IdOf<NtTicket>) {
    return { id, type: typeof id };
  }

  @Get("session/:id")
  session(@Param("id", ParseIdPipe.for(NtSession)) id: IdOf<NtSession>) {
    return { id: id.toHexString(), type: id.constructor.name };
  }
}

@Controller("accounts")
export class AccountsController {
  constructor(@InjectModel(NtAccount) private readonly accounts: Model<NtAccount>) {}

  // @Transactional above the route decorator: the route metadata moves to the wrapper.
  @Transactional()
  @Post("pair")
  async pair(@Body() body: { readonly title: string; readonly fail?: boolean }) {
    await this.accounts.create({ title: body.title, balance: 1 });
    if (body.fail === true) throw new Error("second account refused");
    await this.accounts.create({ title: body.title, balance: 2 });
    return { count: await this.accounts.countDocuments({ title: body.title }) };
  }

  // @Transactional below the route decorator: the route decorator writes on the wrapper.
  @Post("pair-below")
  @Transactional()
  async pairBelow(@Body() body: { readonly title: string }) {
    await this.accounts.create({ title: body.title, balance: 1 });
    throw new Error("refused");
  }

  @Get("count/:title")
  async count(@Param("title") title: string) {
    return { count: await this.accounts.countDocuments({ title }) };
  }
}

@Controller("journal")
export class JournalController {
  constructor(@InjectModel(NtJournal) private readonly journal: Model<NtJournal>) {}

  @Post()
  async write(@Body() body: { readonly title: string }) {
    return (await this.journal.create({ title: body.title })).$toPlain();
  }
}

@Controller("orders")
export class OrdersController {
  constructor(@InjectModel(NtOrder) private readonly orders: Model<NtOrder>) {}

  @Post()
  async create(@Body() body: { readonly number: string }) {
    await Bun.sleep(5);
    return (await this.orders.create({ number: body.number })).$toPlain();
  }

  @Get()
  async list() {
    await Bun.sleep(5);
    return (await this.orders.find().sort({ number: 1 }).plain()).map((order) => order.number);
  }

  @Get("stream")
  stream(): Observable<string[]> {
    return from(
      (async () => {
        await Bun.sleep(5);
        return (await this.orders.find().sort({ number: 1 }).plain()).map((order) => order.number);
      })(),
    );
  }

  @AllTenants()
  @Get("all")
  async all() {
    return (await this.orders.find().sort({ number: 1 }).plain()).map((order) => `${order.tenantId}:${order.number}`);
  }

  @Get("actor")
  actor() {
    return { actor: PolicyContext.current()?.actor ?? null, tenant: PolicyContext.current()?.tenant ?? null };
  }
}

@Module({
  imports: [TypemoModule.forFeature([NtUser, NtCountry, NtTicket, NtSession, NtAccount, NtJournal, NtOrder])],
  controllers: [UsersController, IdsController, AccountsController, JournalController, OrdersController],
  providers: [UsersService],
})
export class E2eFeatureModule {}
