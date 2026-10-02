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
// Close an account; false if there was none
export const closeAccount = async (title: string): Promise<boolean> => {
  const result = await Accounts.deleteOne({ title });
  return result.deletedCount === 1;
};

// Remove every account of an owner and return how many were deleted
export const closeOwner = async (owner: string): Promise<number> => {
  const result = await Accounts.deleteMany({ owner });
  return result.deletedCount;
};

// Delete an account by id and return its data
export const removeById = async (id: string) => {
  return Accounts.findByIdAndDelete(id).plain();
};
