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
  @Transactional()
  async openPair(title: string): Promise<number> {
    await this.accounts.create({ title, balance: 1 });
    await this.accounts.create({ title, balance: 2 });
    return this.accounts.countDocuments({ title });
  }
}
// @filename: spec.ts
// ---cut---
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { TypemoModule } from "@venloc/typemo-nestjs";
import { TypemoTestingModule } from "@venloc/typemo-nestjs/testing";
import { Account, AccountsService } from "./accounts.service";

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

test("opens a pair", async () => {
  expect(await moduleRef.get(AccountsService).openPair("Main")).toBe(2);
});
