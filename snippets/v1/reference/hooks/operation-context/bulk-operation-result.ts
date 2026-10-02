import { Entity, Post, Prop, Schema, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
// ---cut---
  @Post("query.updateOne")
  report(this: OperationHookContext<Account, "query.updateOne">, result: { readonly upsertedId: unknown }): void {
    console.log(this.bulkIndex, JSON.stringify(result));
    // → 1 {"acknowledged":true,"matchedCount":null,"modifiedCount":null,"upsertedCount":1,"upsertedId":"…"}
  }
}
