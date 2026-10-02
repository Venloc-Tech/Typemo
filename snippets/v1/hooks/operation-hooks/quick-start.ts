import { type Defaulted, Entity, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Boolean, { default: false })
  archived!: Defaulted<boolean>;

  @Pre("query.find")
  onlyActive(this: OperationHookContext<Account, "query.find">): void {
    this.modify({ where: { archived: false } });
  }
}
