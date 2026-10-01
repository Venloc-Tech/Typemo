// N4: @Transactional() on the replica set — commit, abort, a retry after a transient error, a named client, the
// errors of misuse (nesting, an object no application knows, an unknown client, a static method), request scope.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Injectable, Module, Scope } from "@nestjs/common";
import type { TestingModule } from "@nestjs/testing";
import { ConfigurationError, Filters, type Model, type TransactionScope, type TypemoClient } from "@venloc/typemo";
import { FailPointHelpers } from "@venloc/typemo-test-kit";
import { getClientToken, InjectClient, InjectModel, Transactional, TypemoModule } from "../../src/index.ts";
import { NtAccount } from "../fixtures/entities.ts";
import { NestTest } from "../support/nest-test.ts";

@Injectable()
class AccountsService {
  attempts = 0;

  constructor(
    @InjectModel(NtAccount) readonly accounts: Model<NtAccount>,
    @InjectModel(NtAccount, { client: "second" }) readonly second: Model<NtAccount>,
  ) {}

  @Transactional()
  async openTwo(title: string): Promise<number> {
    this.attempts += 1;
    await this.accounts.create({ title, balance: 1 });
    await this.accounts.create({ title, balance: 2 });
    return this.accounts.countDocuments({ title });
  }

  @Transactional()
  async openAndFail(title: string): Promise<void> {
    await this.accounts.create({ title, balance: 1 });
    throw new Error("no money");
  }

  @Transactional({ client: "second" })
  async openOnSecond(title: string): Promise<void> {
    await this.second.create({ title, balance: 1 });
    throw new Error("rolled back on second");
  }

  @Transactional()
  async outer(): Promise<void> {
    await this.openTwo("nested");
  }

  @Transactional({ client: "missing" })
  async onMissing(): Promise<void> {}
}

@Injectable({ scope: Scope.REQUEST })
class RequestScoped {
  constructor(@InjectModel(NtAccount) readonly accounts: Model<NtAccount>) {}

  @Transactional()
  async open(title: string): Promise<void> {
    await this.accounts.create({ title, balance: 3 });
  }
}

@Module({
  imports: [TypemoModule.forFeature([NtAccount]), TypemoModule.forFeature([NtAccount], { client: "second" })],
  providers: [AccountsService, RequestScoped],
})
class AccountsModule {}

let ref: TestingModule;
let service: AccountsService;

beforeAll(async () => {
  const uri = await NestTest.uri();
  ref = await NestTest.module([
    TypemoModule.forRoot(uri, { dbName: NestTest.db("tx"), sync: "init" }),
    TypemoModule.forRoot(uri, { name: "second", dbName: NestTest.db("tx2"), sync: "init" }),
    AccountsModule,
  ]);
  service = ref.get(AccountsService);
});
afterAll(() => ref.close());

describe("@Transactional()", () => {
  test("commits when the method resolves and returns its value (read inside the transaction)", async () => {
    expect(await service.openTwo("commit")).toBe(2);
    expect(await service.accounts.countDocuments({ title: "commit" })).toBe(2);
  });

  test("aborts when the method rejects: nothing is written, the error reaches the caller", async () => {
    await expect(service.openAndFail("abort")).rejects.toThrow("no money");
    expect(await service.accounts.countDocuments({ title: "abort" })).toBe(0);
  });

  test("a transient error retries the method", async () => {
    const driver = ref.get<TypemoClient>(getClientToken()).unsafeDriver();
    const failPoint = await FailPointHelpers.configureFailCommand(driver, {
      failCommands: ["insert"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    try {
      service.attempts = 0;
      expect(await service.openTwo("retry")).toBe(2);
      expect(service.attempts).toBe(2);
    } finally {
      await failPoint.disable();
    }
  });

  test("the client option runs the transaction on that client", async () => {
    await expect(service.openOnSecond("second")).rejects.toThrow("rolled back on second");
    expect(await service.second.countDocuments({ title: "second" })).toBe(0);
  });

  test("a decorated method called from another one is the core's nesting error", async () => {
    const error = await service.outer().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toBe(
      "transaction(): transactions do not nest (already inside a transaction of this client)",
    );
  });

  test("an unknown client is a clear error at the call", async () => {
    const error = await service.onMissing().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toBe(
      '@Transactional(): no TypemoClient named "missing" in this application (TypemoModule.forRoot(uri, { name: "missing" }))',
    );
  });

  test("an object created outside Nest is refused, not run without a transaction", async () => {
    const loose = new AccountsService(service.accounts, service.second);
    const error = await loose.openTwo("loose").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toBe(
      "@Transactional(): AccountsService.openTwo was called on an object no Nest application with TypemoModule has registered; it works on the providers and controllers of such an application",
    );
    expect(await service.accounts.countDocuments({ title: "loose" })).toBe(0);
  });

  test("a request-scoped provider is bound through its class", async () => {
    const scoped = await ref.resolve(RequestScoped);
    await scoped.open("scoped");
    expect(await service.accounts.countDocuments({ title: "scoped" })).toBe(1);
  });

  test("a static method cannot be decorated", () => {
    expect(() => {
      class Wrong {
        @Transactional()
        static async run(): Promise<void> {}
      }
      return Wrong;
    }).toThrow("@Transactional(): Wrong.run is static; decorate an instance method");
  });

  test("the method keeps its name", () => {
    expect(service.openTwo.name).toBe("openTwo");
  });
});

describe("after the application shuts down", () => {
  test("its objects are no longer bound", async () => {
    @Injectable()
    class Short {
      constructor(@InjectModel(NtAccount) readonly accounts: Model<NtAccount>) {}
      @Transactional()
      async clean(): Promise<void> {
        await this.accounts.deleteMany(Filters.all());
      }
    }
    @Module({ imports: [TypemoModule.forFeature([NtAccount])], providers: [Short] })
    class ShortModule {}
    const short = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("short"), sync: "init" }),
      ShortModule,
    ]);
    const instance = short.get(Short);
    await instance.clean();
    await short.close();
    await expect(instance.clean()).rejects.toThrow(ConfigurationError);
  });
});

describe("two databases of one client", () => {
  test("one transaction covers both, and rolls both back", async () => {
    @Injectable()
    class Archiver {
      constructor(
        @InjectModel(NtAccount) readonly main: Model<NtAccount>,
        @InjectModel(NtAccount, { db: "nest_tx_archive" }) readonly archive: Model<NtAccount>,
      ) {}
      @Transactional()
      async move(title: string, fail: boolean): Promise<void> {
        await this.main.create({ title, balance: 1 });
        await this.archive.create({ title, balance: 1 });
        if (fail) throw new Error("stop");
      }
    }
    @Module({
      imports: [TypemoModule.forFeature([NtAccount]), TypemoModule.forFeature([NtAccount], { db: "nest_tx_archive" })],
      providers: [Archiver],
    })
    class ArchiveModule {}
    const two = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("txmain"), sync: "init" }),
      ArchiveModule,
    ]);
    const archiver = two.get(Archiver);
    await expect(archiver.move("both", true)).rejects.toThrow("stop");
    expect(await archiver.main.countDocuments({ title: "both" })).toBe(0);
    expect(await archiver.archive.countDocuments({ title: "both" })).toBe(0);
    await archiver.move("both", false);
    expect(await archiver.archive.countDocuments({ title: "both" })).toBe(1);
    await archiver.archive.connection.client.unsafeDriver().db("nest_tx_archive").dropDatabase();
    await two.close();
  });
});

describe("@Transactional({ join: true }) (decision R65)", () => {
  @Injectable()
  class LedgerService {
    innerRuns = 0;
    seen: (TransactionScope | undefined)[] = [];

    constructor(
      @InjectModel(NtAccount) readonly accounts: Model<NtAccount>,
      @InjectClient() readonly client: TypemoClient,
      @InjectClient("second") readonly second: TypemoClient,
    ) {}

    @Transactional({ join: true })
    async entry(title: string, fail = false): Promise<void> {
      this.innerRuns += 1;
      this.seen.push(this.client.currentTransaction());
      await this.accounts.create({ title, balance: 1 });
      if (fail) throw new Error("entry refused");
    }

    @Transactional()
    async pair(title: string, failSecond = false): Promise<number> {
      await this.entry(title);
      await this.entry(title, failSecond);
      return this.accounts.countDocuments({ title });
    }

    @Transactional({ client: "second" })
    async inOtherClient(title: string): Promise<void> {
      await this.entry(title);
    }
  }

  let ledgerRef: TestingModule;
  let ledger: LedgerService;
  beforeAll(async () => {
    @Module({ imports: [TypemoModule.forFeature([NtAccount])], providers: [LedgerService] })
    class LedgerModule {}
    const uri = await NestTest.uri();
    ledgerRef = await NestTest.module([
      TypemoModule.forRoot(uri, { dbName: NestTest.db("join"), sync: "init" }),
      TypemoModule.forRoot(uri, { name: "second", dbName: NestTest.db("join2") }),
      LedgerModule,
    ]);
    ledger = ledgerRef.get(LedgerService);
  });
  afterAll(() => ledgerRef.close());

  test("inside an open transaction of the same client it runs in that transaction", async () => {
    ledger.seen = [];
    expect(await ledger.pair("joined")).toBe(2);
    expect(ledger.seen[0]).toBeDefined();
    expect(ledger.seen[0]).toBe(ledger.seen[1]);
  });

  test("without an outer transaction it opens its own", async () => {
    ledger.seen = [];
    await ledger.entry("alone");
    expect(ledger.seen[0]).toBeDefined();
    expect(await ledger.accounts.countDocuments({ title: "alone" })).toBe(1);
    expect(ledger.client.currentTransaction()).toBeUndefined();
  });

  test("an error inside the joined method propagates and aborts the outer transaction", async () => {
    await expect(ledger.pair("aborted", true)).rejects.toThrow("entry refused");
    expect(await ledger.accounts.countDocuments({ title: "aborted" })).toBe(0);
  });

  test("a transient error retries the whole outer transaction, the joined method included", async () => {
    const failPoint = await FailPointHelpers.configureFailCommand(ledger.client.unsafeDriver(), {
      failCommands: ["insert"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    try {
      ledger.innerRuns = 0;
      expect(await ledger.pair("retried")).toBe(2);
      expect(ledger.innerRuns).toBe(3);
      expect(await ledger.accounts.countDocuments({ title: "retried" })).toBe(2);
    } finally {
      await failPoint.disable();
    }
  });

  test("inside a transaction of another client it is an explicit error", async () => {
    const error = await ledger.inOtherClient("other").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toBe(
      '@Transactional({ join: true }): LedgerService.entry was called inside a transaction of another client; it joins only a transaction of client "default"',
    );
    expect(await ledger.accounts.countDocuments({ title: "other" })).toBe(0);
  });

  test("without join the strict nesting error stays", async () => {
    const error = await service.outer().catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      "transaction(): transactions do not nest (already inside a transaction of this client)",
    );
  });

  test("join with transaction options is refused when the method is decorated", () => {
    expect(() => {
      class Wrong {
        @Transactional({ join: true, timeoutMS: 100 } as never)
        async run(): Promise<void> {}
      }
      return Wrong;
    }).toThrow(
      "@Transactional({ join: true }): timeoutMS cannot go with join; a joined method runs in the outer transaction, give the options to it",
    );
  });
});
