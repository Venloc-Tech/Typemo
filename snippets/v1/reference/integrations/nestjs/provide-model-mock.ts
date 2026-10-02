import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel } from "@venloc/typemo-nestjs";
import { provideModelMock } from "@venloc/typemo-nestjs/testing";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
@Injectable()
class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}
  count() {
    return this.accounts.countDocuments({ balance: { $gt: 0 } });
  }
}
// ---cut---
const moduleRef = await Test.createTestingModule({
  providers: [AccountsService, provideModelMock(Account, { countDocuments: async () => 3 })],
}).compile();
console.log(await moduleRef.get(AccountsService).count());
// → 3
