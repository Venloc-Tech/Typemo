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
  await Accounts.bulkWrite(
    [
      { insertOne: { document: { title: "B4", owner: "o" } } },
      { insertOne: { document: { title: "B1", owner: "o" } } }, // B1 already exists
      { insertOne: { document: { title: "B5", owner: "o", balance: -3 } } }, // fails validation
      { insertOne: { document: { title: "B6", owner: "o" } } },
    ],
    { ordered: false },
  );
} catch (error) {
  if (error instanceof BulkWriteError) {
    console.log(error.result.insertedCount);
    // → 2
  }
}
