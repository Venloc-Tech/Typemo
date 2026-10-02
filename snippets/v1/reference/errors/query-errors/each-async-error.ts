import { EachAsyncError, Entity, Prop, Schema, TypemoClient, Versioned } from "@venloc/typemo";
@Schema({ collection: "accounts", optimisticConcurrency: true })
class Account extends Versioned(Entity) {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
try {
  await Accounts.find()
    .cursor()
    .eachAsync(
      (account) => {
        if (account.title === "a" || account.title === "c") throw new Error(`boom ${account.title}`);
      },
      { continueOnError: true },
    );
} catch (error) {
  if (error instanceof EachAsyncError) {
    console.log(error.message);
    // → eachAsync: 2 call(s) of the callback failed (continueOnError)
    console.log(error.errors.map((e) => (e as Error).message));
    // → ["boom a", "boom c"]
    console.log((error.cause as Error).message);
    // → "boom a"
  }
}
