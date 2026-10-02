import { Injectable } from "@nestjs/common";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, Transactional } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
// ---cut---
@Injectable()
export class LedgerService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Transactional({ join: true })
  async entry(title: string): Promise<void> {
    await this.accounts.create({ title, balance: 1 });
  }

  @Transactional()
  async pair(title: string): Promise<number> {
    await this.entry(title);
    await this.entry(title);
    return this.accounts.countDocuments({ title });
  }
}
