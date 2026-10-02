import { Body, Controller, Post } from "@nestjs/common";
import { type CreateInput, Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, ValidateBodyPipe } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
// ---cut---
@Controller("accounts")
export class AccountsController {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Post()
  async open(@Body(ValidateBodyPipe.for(Account)) body: CreateInput<Account>) {
    return (await this.accounts.create(body)).$toPlain();
  }
}
