import { Injectable } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, Transactional } from "@venloc/typemo-nestjs";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;
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
