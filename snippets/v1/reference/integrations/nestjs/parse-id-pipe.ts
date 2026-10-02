import { Controller, Get, Param } from "@nestjs/common";
import { Entity, type IdOf, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, ParseIdPipe } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
// ---cut---
@Controller("accounts")
export class AccountsController {
  constructor(@InjectModel(Account) private readonly accounts: Model<Account>) {}

  @Get(":id")
  get(@Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>) {
    return this.accounts.findById(id).orFail().plain();
  }
}
