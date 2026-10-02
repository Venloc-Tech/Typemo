import { type Defaulted, Entity, Post, PostError, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { min: 0, default: 0 })
  balance!: Defaulted<number>;

  @Prop(() => String)
  note?: string;

  // For an operation inside bulkWrite, append its index to the update.
  @Pre("query.updateOne")
  markNote(this: OperationHookContext<Account, "query.updateOne">): void {
    if (this.bulkIndex !== undefined) this.modify({ update: { $set: { note: `bulk #${this.bulkIndex}` } } });
  }

  @Post("query.updateOne")
  logUpdate(this: OperationHookContext<Account, "query.updateOne">, result: { readonly upsertedId: unknown }): void {
    console.log("post updateOne", this.bulkIndex, result.upsertedId === null ? "no upsert" : "upsert");
  }

  @Post("query.deleteOne")
  logDelete(this: OperationHookContext<Account, "query.deleteOne">, result: { readonly deletedCount: number | null }): void {
    console.log("post deleteOne", this.bulkIndex, result.deletedCount);
  }

  @Post("model.bulkWrite")
  logBulk(this: OperationHookContext<Account, "model.bulkWrite">, result: { readonly matchedCount: number }): void {
    console.log("post bulkWrite, matched", result.matchedCount);
  }

  @PostError("model.bulkWrite")
  failBulk(this: OperationHookContext<Account, "model.bulkWrite">, error: unknown): void {
    console.log("postError bulkWrite", error instanceof Error ? error.name : error);
  }

  @Post("document.save")
  saved(this: Account): void {
    console.log("post save", this.title);
  }

  @PostError("document.save")
  notSaved(this: Account, error: unknown): void {
    console.log("postError save", this.title, error instanceof Error ? error.name : error);
  }

  @PostError("query.deleteOne")
  notDeleted(this: OperationHookContext<Account, "query.deleteOne">, error: unknown): void {
    console.log("postError deleteOne", this.bulkIndex, error instanceof Error ? error.name : error);
  }
}
