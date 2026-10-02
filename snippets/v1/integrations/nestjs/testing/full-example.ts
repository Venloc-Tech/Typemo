// @filename: accounts.service.ts
import { Injectable } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, Transactional } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
@Injectable()
export class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}
  countFunded() {
    return this.accounts.countDocuments({ balance: { $gt: 0 } });
  }
  @Transactional()
  async openPair(title: string): Promise<number> {
    await this.accounts.create({ title, balance: 1 });
    await this.accounts.create({ title, balance: 2 });
    return this.accounts.countDocuments({ title });
  }
}
// @filename: spec.ts
// ---cut---
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { TypemoModule } from "@venloc/typemo-nestjs";
import { provideClientMock, provideModelMock, TypemoTestingModule } from "@venloc/typemo-nestjs/testing";
import { Account, AccountsService } from "./accounts.service";

// without a database: service logic
describe("AccountsService with mocks", () => {
  test("counts funded accounts", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AccountsService, provideModelMock(Account, { countDocuments: async () => 3 }), ...provideClientMock()],
    }).compile();
    await moduleRef.init();
    expect(await moduleRef.get(AccountsService).countFunded()).toBe(3);
  });
});

// with a database: queries and a transaction
describe("AccountsService on MongoDB", () => {
  let moduleRef: TestingModule;
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TypemoTestingModule.forRoot(process.env.MONGO_URI ?? ""), TypemoModule.forFeature([Account])],
      providers: [AccountsService],
    }).compile();
    await moduleRef.init();
  });
  afterEach(() => TypemoTestingModule.clear(moduleRef));
  afterAll(() => moduleRef.close());

  test("opens a pair in one transaction", async () => {
    expect(await moduleRef.get(AccountsService).openPair("Main")).toBe(2);
  });
});
