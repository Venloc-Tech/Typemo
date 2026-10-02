import { Injectable } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number; // [!code ++]
}
// ---cut---
@Injectable()
export class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  async rich() {
    const rows = await this.accounts.find({ balance: { $gt: 100 } }).select({ title: 1 }).plain();
    //    ^?
    return rows;
  }
}
