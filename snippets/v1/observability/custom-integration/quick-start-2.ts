import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
import type { InstrumentationSubscriber, Subscription } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
declare const OperationStats: {
  instrument(target: { instrument: (s: InstrumentationSubscriber) => Subscription }): {
    stats: { snapshot(): Record<string, { count: number; errors: number; totalMS: number }> };
    subscription: Subscription;
  };
};
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
const Accounts = client.db().model(Account);
// ---cut---
const { stats, subscription } = OperationStats.instrument(client);

await Accounts.create({ title: "Main", balance: 100 });
await Accounts.find({}).plain();
await Accounts.find({}).plain();
await Accounts.find({ title: "none" }).orFail().catch(() => undefined);

const snapshot = stats.snapshot();
// snapshot["Account.insertOne"].count → 1
// snapshot["Account.find"].count → 3, snapshot["Account.find"].errors → 1

subscription.unsubscribe();
