import {
  type Defaulted,
  Entity,
  Post,
  Pre,
  Prop,
  Schema,
  type OperationHookContext,
} from "@venloc/typemo";

export const settings = { dryRun: false };

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Boolean, { default: false })
  archived!: Defaulted<boolean>;

  @Prop(() => Number, { default: 0 })
  revision!: Defaulted<number>;

  // Every read skips archived accounts.
  @Pre("query.find")
  onlyActive(this: OperationHookContext<Account, "query.find">): void {
    this.modify({ where: { archived: false } });
  }

  // Every bulk update bumps the revision.
  @Pre("query.updateMany")
  bumpRevision(this: OperationHookContext<Account, "query.updateMany">): void {
    this.modify({ update: { $inc: { revision: 1 } } });
  }

  // Dry run: the delete does not reach the database.
  @Pre("query.deleteMany")
  dryRun(this: OperationHookContext<Account, "query.deleteMany">): void {
    if (settings.dryRun) this.skip({ acknowledged: true, deletedCount: 0 });
  }

  // Log the delete result.
  @Post("query.deleteMany")
  logDeleted(this: OperationHookContext<Account, "query.deleteMany">, result: { readonly deletedCount: number | null }): void {
    console.log(`accounts deleted: ${result.deletedCount}`);
  }
}
