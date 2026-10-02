// @filename: accounts.service.ts
import { Injectable } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel } from "@venloc/typemo-nestjs";
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
}
// @filename: spec.ts
// ---cut---
import { expect, test } from "bun:test";
import { Test } from "@nestjs/testing";
import { provideModelMock } from "@venloc/typemo-nestjs/testing";
import { Account, AccountsService } from "./accounts.service";

test("counts funded accounts", async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [AccountsService, provideModelMock(Account, { countDocuments: async () => 3 })],
  }).compile();
  expect(await moduleRef.get(AccountsService).countFunded()).toBe(3);
});
