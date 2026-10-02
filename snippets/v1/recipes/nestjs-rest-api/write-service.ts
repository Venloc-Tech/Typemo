import { Injectable } from "@nestjs/common";
import { type CreateInput, type Defaulted, Entity, type IdOf, type Model, Prop, Schema, Tenant, type TenantField, type UpdateInput } from "@venloc/typemo";
import { InjectModel, Transactional } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts", tenant: true })
class Account extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true, minLength: 1 }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
  @Prop(() => String, { enum: ["open", "closed"] as const, default: "open" }) status!: Defaulted<"open" | "closed">;
}
// ---cut---
@Injectable()
export class AccountsService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  list(status: "open" | "closed" | undefined, limit: number) {
    return this.accounts
      .find(status === undefined ? {} : { status })
      .sort({ title: 1 })
      .limit(limit)
      .select({ title: 1, balance: 1, status: 1 })
      .plain();
  }

  get(id: IdOf<Account>) {
    return this.accounts.findById(id).orFail().plain();
  }

  async open(body: CreateInput<Account>) {
    return (await this.accounts.create(body)).$toPlain();
  }

  update(id: IdOf<Account>, body: UpdateInput<Account>) {
    return this.accounts.findByIdAndUpdate(id, { $set: body }).orFail().plain();
  }

  async close(id: IdOf<Account>): Promise<void> {
    await this.accounts.updateOne({ _id: id }, { $set: { status: "closed" } });
  }

  @Transactional()
  async transfer(from: IdOf<Account>, to: IdOf<Account>, amount: number): Promise<void> {
    await this.accounts.findOneAndUpdate({ _id: from, status: "open" }, { $inc: { balance: -amount } }).orFail();
    await this.accounts.findOneAndUpdate({ _id: to, status: "open" }, { $inc: { balance: amount } }).orFail();
  }
}
