import { BulkWriteError, DuplicateKeyError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
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
const rows = [
  { title: "N1", owner: "a" },
  { title: "Main", owner: "b" },
  { title: "N2", owner: "c" },
];

try {
  await Accounts.insertMany(rows, { ordered: false });
} catch (error) {
  if (error instanceof BulkWriteError) {
    const duplicates = error.writeErrors.filter((failure) => failure.error instanceof DuplicateKeyError);
    console.log(duplicates.map((failure) => failure.index), error.result.insertedCount);
    // → [1] 2
  }
}
