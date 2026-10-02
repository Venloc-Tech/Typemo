import { Entity, Prop, QueryError, Schema, TypemoClient, Versioned } from "@venloc/typemo";
@Schema({ collection: "accounts", optimisticConcurrency: true })
class Account extends Versioned(Entity) {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const filter = JSON.parse("{}");
filter.title = undefined;

try {
  await Accounts.find(filter);
} catch (error) {
  if (error instanceof QueryError) {
    console.log(error.message);
    // → filter: undefined at "title" (use $exists: false / $unset; undefined is never a value)
    console.log(error.path);
    // → "title"
  }
}
