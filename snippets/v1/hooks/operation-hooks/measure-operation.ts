import { Entity, Post, Pre, Prop, Schema, TypemoClient, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;

  @Pre("query.find")
  start(this: OperationHookContext<Account, "query.find">): void {
    this.locals.set("startedAt", performance.now());
  }

  @Post("query.find")
  finish(this: OperationHookContext<Account, "query.find">, result: readonly unknown[]): void {
    const startedAt = this.locals.get("startedAt") as number;
    console.log(`${this.model}.${this.operation}: ${result.length} documents in ${Math.round(performance.now() - startedAt)} ms`);
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
await Accounts.find({ owner: "alice" });
// → Account.find: 2 documents in … ms
