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
  await Accounts.insertMany([
    { title: "I1", owner: "c" },
    { title: "Main", owner: "c" }, // this title already exists
    { title: "I3", owner: "c" },
  ]);
} catch (error) {
  if (error instanceof BulkWriteError) {
    console.log(error.ordered, error.writeErrors.map((failure) => failure.index));
    // → true [1]
    console.log(error.result.insertedCount);
    // → 1
  }
}
