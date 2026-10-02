import { Entity, Post, Prop, Schema, type OperationHookContext } from "@venloc/typemo";
// ---cut---
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Post("query.deleteMany")
  logDeleted(this: OperationHookContext<Account, "query.deleteMany">, result: { readonly deletedCount: number | null }): void {
    console.log(`удалено счетов: ${result.deletedCount}`);
  }
}
