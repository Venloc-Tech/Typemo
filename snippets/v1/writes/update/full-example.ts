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
// Top up an account; false if there is no such account or the balance would cross the limit
export const topUp = async (title: string, amount: number): Promise<boolean> => {
  try {
    const result = await Accounts.updateOne({ title }, { $inc: { balance: amount } });
    return result.matchedCount === 1;
  } catch (error) {
    if (error instanceof ValidationError) return false;
    throw error;
  }
};

// Change the note and return the document by id from the URL
export const renameNote = async (id: string, note: string) => {
  return Accounts.findByIdAndUpdate(id, { $set: { note } }).plain();
};

// Change the account owner or open the account with a starting balance
export const reassignOrOpen = async (title: string, owner: string, amount: number) => {
  await Accounts.updateOne(
    { title },
    { $set: { owner }, $setOnInsert: { balance: amount } },
    { upsert: true },
  );
};
