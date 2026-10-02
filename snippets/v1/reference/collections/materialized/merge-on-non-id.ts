import { Entity, Index, Prop, Schema } from "@venloc/typemo";

@Index({ title: 1 }, { unique: true })
@Schema({ collection: "account_balances" })
export class AccountBalance extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  balance!: number;
}
