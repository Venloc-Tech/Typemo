import { BulkWriteError, type Defaulted, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
  @Prop(() => String) note?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
try {
  await Accounts.bulkWrite(
    [
      { insertOne: { document: { title: "U1", owner: "o" } } },
      { insertOne: { document: { title: "Main", owner: "dup" } } },
      { deleteOne: { filter: { title: "U1" } } },
    ],
    { ordered: false },
  );
} catch (error) {
  if (error instanceof BulkWriteError) {
    console.log(Object.keys(error.result.insertedIds), error.writeErrors.map((failure) => failure.index));
    // → ["0"] [1]
  }
}
// → postError bulkWrite BulkWriteError
// → post save U1
// → postError save Main BulkWriteError
// → post deleteOne 2 null
