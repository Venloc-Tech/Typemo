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
// Apply a batch of changes from an external system
export const applyBatch = async (changes: { title: string; owner: string }[]) => {
  return Accounts.bulkWrite(
    changes.map(({ title, owner }) => ({
      updateOne: { filter: { title }, update: { $set: { owner } }, upsert: true },
    })),
    { ordered: false },
  );
};

// Load rows and return the numbers of those not written
export const importRows = async (rows: { title: string; owner: string }[]): Promise<number[]> => {
  try {
    await Accounts.bulkWrite(rows.map((document) => ({ insertOne: { document } })), { ordered: false });
    return [];
  } catch (error) {
    if (error instanceof BulkWriteError) return error.writeErrors.map((failure) => failure.index);
    throw error;
  }
};

// Save documents changed in memory in one request
export const saveAll = async (owner: string) => {
  const accounts = await Accounts.find({ owner });
  for (const account of accounts) account.note = "reviewed";
  return Accounts.bulkSave(accounts);
};
