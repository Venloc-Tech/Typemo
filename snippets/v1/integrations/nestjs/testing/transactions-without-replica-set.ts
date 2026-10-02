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
    return this.accounts.countDocuments({ title });
  }
}
// @filename: spec.ts
// ---cut---
import { expect, test } from "bun:test";
import { Test } from "@nestjs/testing";
import { provideClientMock, provideModelMock } from "@venloc/typemo-nestjs/testing";
import { Account, AccountsService } from "./accounts.service";

test("opens a pair in a transaction", async () => {
  const calls: string[] = [];
  const moduleRef = await Test.createTestingModule({
    providers: [
      AccountsService,
      provideModelMock(Account, { create: async () => ({}), countDocuments: async () => 2 }),
      ...provideClientMock({
        transaction: async (fn: (scope: never) => Promise<unknown>) => {
          calls.push("transaction");
          return fn(undefined as never);
        },
      }),
    ],
  }).compile();
  await moduleRef.init();
  expect(await moduleRef.get(AccountsService).openPair("Main")).toBe(2);
  expect(calls).toEqual(["transaction"]);
});
