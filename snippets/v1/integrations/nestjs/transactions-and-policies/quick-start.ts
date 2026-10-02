import { Injectable, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, PolicyInterceptor, Transactional } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
@Module({})
class AppModule {}
// ---cut---
@Injectable()
export class TransfersService {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Transactional()
  async transfer(from: Account["_id"], to: Account["_id"], amount: number): Promise<void> {
    await this.accounts.updateOne({ _id: from }, { $inc: { balance: -amount } });
    await this.accounts.updateOne({ _id: to }, { $inc: { balance: amount } });
  }
}

const app = await NestFactory.create(AppModule);
app.useGlobalInterceptors(new PolicyInterceptor({ tenant: (request) => request.headers["x-tenant"] }));
