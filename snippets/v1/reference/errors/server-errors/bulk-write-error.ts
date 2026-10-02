import { BulkWriteError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
await client.connection.init();
await Accounts.create({ title: "Main", owner: "alice" });
// ---cut---
const documents = [
  { title: "N1", owner: "a" },
  { title: "Main", owner: "b" },
  { title: "N2", owner: "c" },
  { title: "N1", owner: "d" },
];

try {
  await Accounts.insertMany(documents, { ordered: false });
} catch (error) {
  if (error instanceof BulkWriteError) {
    console.log(error.message);
    // → Account.insertMany: 2 write(s) failed (first at index 1: duplicate key on title_1 (code 11000 DuplicateKey))
    console.log(error.writeErrors.map((failure) => [failure.index, failure.code]));
    // → [[1, 11000], [3, 11000]]
    console.log(error.result.insertedCount, error.ordered);
    // → 2 false
  }
}
