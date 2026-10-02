import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Query } from "@nestjs/common";
import { type CreateInput, type Defaulted, Entity, type IdOf, type Model, Prop, Schema, Tenant, type TenantField, type UpdateInput } from "@venloc/typemo";
import { InjectModel, ParseIdPipe, ValidateBodyPipe } from "@venloc/typemo-nestjs";
@Schema({ collection: "accounts", tenant: true })
class Account extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true, minLength: 1 }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
  @Prop(() => String, { enum: ["open", "closed"] as const, default: "open" }) status!: Defaulted<"open" | "closed">;
}
@Injectable()
class AccountsService {
  list(_status: "open" | "closed" | undefined, _limit: number) { return []; }
  get(_id: IdOf<Account>) { return {}; }
  open(_body: CreateInput<Account>) { return {}; }
  update(_id: IdOf<Account>, _body: UpdateInput<Account>) { return {}; }
  async close(_id: IdOf<Account>) {}
  async transfer(_from: IdOf<Account>, _to: IdOf<Account>, _amount: number) {}
}
// ---cut---
const STATUSES = ["open", "closed"] as const;

@Controller("accounts")
export class AccountsController {
  constructor(
    private readonly service: AccountsService,
    @InjectModel(Account) private readonly accounts: Model<Account>,
  ) {}

  @Get()
  list(@Query("status") status?: string, @Query("limit") limit = "20") {
    if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(`status is one of ${STATUSES.join(", ")}`);
    }
    const count = Number(limit);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new BadRequestException("limit is 1 to 100");
    return this.service.list(status as "open" | "closed" | undefined, count);
  }

  @Get(":id")
  get(@Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>) {
    return this.service.get(id);
  }

  @Post()
  open(@Body(ValidateBodyPipe.for(Account, { pick: ["title", "balance"] })) body: CreateInput<Account>) {
    return this.service.open(body);
  }

  @Patch(":id")
  update(
    @Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>,
    @Body(ValidateBodyPipe.for(Account, { pick: ["title"], partial: true })) body: UpdateInput<Account>,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  close(@Param("id", ParseIdPipe.for(Account)) id: IdOf<Account>) {
    return this.service.close(id);
  }

  @Post("transfer")
  @HttpCode(204)
  transfer(@Body() body: { readonly from: string; readonly to: string; readonly amount: number }) {
    if (typeof body.amount !== "number" || !(body.amount > 0)) throw new BadRequestException("amount is positive");
    const ids = new ParseIdPipe(this.accounts);
    return this.service.transfer(ids.transform(body.from), ids.transform(body.to), body.amount);
  }
}
