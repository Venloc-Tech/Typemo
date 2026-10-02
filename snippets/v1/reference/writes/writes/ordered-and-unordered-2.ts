import { BulkWriteError, CastError, type CreateInput, type Defaulted, DocumentNotFoundError, DuplicateKeyError, Entity, Filters, fn, type Immutable, Prop, QueryError, type Replacement, Schema, Spec, StrictModeError, Timestamped, TypemoClient, type Update, type UpdateInput, type UpdatePipelineFor, UpdatePipelines, ValidationError, type WriteValue } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => String) note?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
try {
  await Accounts.insertMany(
    [
      { title: "U1", owner: "d" },
      { title: "Main", owner: "d" }, // duplicate: the server rejects it
      { title: "U3", owner: "d", balance: -5 }, // Typemo rejects it before sending
      { title: "U4", owner: "d" },
    ],
    { ordered: false },
  );
} catch (error) {
  if (error instanceof BulkWriteError) {
    console.log(error.writeErrors.map((failure) => [failure.index, failure.error.name]));
    // → [[1, "DuplicateKeyError"], [2, "ValidationError"]]
    console.log(error.result.insertedCount);
    // → 2
  }
}
