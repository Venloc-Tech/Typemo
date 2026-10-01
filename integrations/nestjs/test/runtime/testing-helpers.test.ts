// N6: `@venloc/typemo-nestjs/testing` — mocks for unit tests without a database, and TypemoTestingModule on the real
// server with `clear` between tests.
import { describe, expect, test } from "bun:test";
import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { type Model, PolicyContext, type TypemoClient } from "@venloc/typemo";
import { getClientToken, getModelToken, InjectModel, Transactional, TypemoModule } from "../../src/index.ts";
import { provideClientMock, provideModelMock, TypemoTestingModule } from "../../src/testing/index.ts";
import { NtAccount, NtOrder } from "../fixtures/entities.ts";
import { NestTest } from "../support/nest-test.ts";

@Injectable()
class AccountsService {
  constructor(@InjectModel(NtAccount) private readonly accounts: Model<NtAccount>) {}

  count(): Promise<number> {
    return this.accounts.countDocuments({ title: "x" });
  }

  removeAll(): Promise<unknown> {
    return this.accounts.deleteOne({ title: "x" });
  }

  @Transactional()
  async countInTransaction(): Promise<number> {
    return this.count();
  }
}

describe("mocks", () => {
  test("provideModelMock replaces the model of an entity", async () => {
    const ref = await Test.createTestingModule({
      providers: [AccountsService, provideModelMock(NtAccount, { countDocuments: async () => 3 })],
    }).compile();
    expect(await ref.get(AccountsService).count()).toBe(3);
  });

  test("a member that was not mocked is undefined, so calling it fails loudly", async () => {
    const ref = await Test.createTestingModule({
      providers: [AccountsService, provideModelMock(NtAccount, { countDocuments: async () => 3 })],
    }).compile();
    expect(() => ref.get(AccountsService).removeAll()).toThrow(TypeError);
  });

  test("a mock for a client and a database is registered under their token", async () => {
    const ref = await Test.createTestingModule({
      providers: [provideModelMock(NtAccount, { countDocuments: async () => 7 }, { client: "archive", db: "old" })],
    }).compile();
    const mock = ref.get<Model<NtAccount>>(getModelToken(NtAccount, { client: "archive", db: "old" }));
    expect(await mock.countDocuments({})).toBe(7);
  });

  test("provideClientMock: @Transactional runs the method through the mock's transaction", async () => {
    const calls: string[] = [];
    const ref = await Test.createTestingModule({
      providers: [
        AccountsService,
        provideModelMock(NtAccount, { countDocuments: async () => 5 }),
        ...provideClientMock({
          transaction: async (fn: (scope: never) => Promise<unknown>) => {
            calls.push("transaction");
            return fn(undefined as never);
          },
        }),
      ],
    }).compile();
    await ref.init();
    expect(await ref.get(AccountsService).countInTransaction()).toBe(5);
    expect(calls).toEqual(["transaction"]);
    await ref.close();
  });

  test("provideClientMock's default transaction calls the function at once", async () => {
    const ref = await Test.createTestingModule({
      providers: [
        AccountsService,
        provideModelMock(NtAccount, { countDocuments: async () => 1 }),
        ...provideClientMock(),
      ],
    }).compile();
    await ref.init();
    expect(await ref.get(AccountsService).countInTransaction()).toBe(1);
    expect(typeof ref.get<TypemoClient>(getClientToken()).transaction).toBe("function");
    await ref.close();
  });
});

describe("TypemoTestingModule", () => {
  test("forRoot: a database of its own, collections created at start; clear empties every model across tenants", async () => {
    @Module({ imports: [TypemoModule.forFeature([NtAccount, NtOrder])] })
    class Feature {}
    const ref = await NestTest.module([TypemoTestingModule.forRoot(await NestTest.uri()), Feature]);
    const client = ref.get<TypemoClient>(getClientToken());
    expect(client.connection.name).toStartWith("typemo_test_");
    const names = (await client.unsafeDriver().db(client.connection.name).listCollections().toArray()).map(
      (c) => c.name,
    );
    expect(names.sort()).toEqual(["nt_accounts", "nt_orders"]);
    const accounts = ref.get<Model<NtAccount>>(getModelToken(NtAccount));
    const orders = ref.get<Model<NtOrder>>(getModelToken(NtOrder));
    await accounts.create({ title: "a", balance: 1 });
    await PolicyContext.run({ tenant: "acme" }, () => orders.create({ number: "1" }));
    await PolicyContext.run({ tenant: "globex" }, () => orders.create({ number: "2" }));
    await TypemoTestingModule.clear(ref);
    expect(await accounts.countDocuments({ title: "a" })).toBe(0);
    expect(
      await PolicyContext.run({ allTenants: true }, () => orders.countDocuments({ number: { $exists: true } })),
    ).toBe(0);
    await client.unsafeDriver().db(client.connection.name).dropDatabase();
    await ref.close();
  });
});
