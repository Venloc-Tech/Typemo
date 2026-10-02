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
export const applyBatch = async () => {
  return Accounts.bulkWrite([
    { insertOne: { document: { title: "B1", owner: "o" } } },
    { updateOne: { filter: { title: "Main" }, update: { $set: { owner: "bulk" } } } },
    { updateMany: { filter: { owner: "o" }, update: { $set: { note: "batch" } } } },
    { replaceOne: { filter: { title: "B1" }, replacement: { title: "B1", owner: "rep" } } },
    { updateOne: { filter: { title: "Ghost" }, update: { $set: { owner: "g" } }, upsert: true } },
    { deleteOne: { filter: { title: "Ghost" } } },
  ]);
};
