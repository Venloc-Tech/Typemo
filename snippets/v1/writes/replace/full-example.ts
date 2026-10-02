import { BulkWriteError, CastError, type CreateInput, type Defaulted, DocumentNotFoundError, DuplicateKeyError, Entity, Filters, fn, type Immutable, Prop, QueryError, type Replacement, Schema, Spec, StrictModeError, Timestamped, TypemoClient, type Update, type UpdateInput, type UpdatePipelineFor, UpdatePipelines, ValidationError, type WriteValue } from "@venloc/typemo";
@Schema()
class Line {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;
}
@Schema({ collection: "accounts" })
class Account extends Timestamped(Entity) {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => String) note?: string;
  @Prop(() => String) nickname?: string;
  @Prop(() => String) alias?: string;
  @Prop(() => Date) lastLogin?: Date;
  @Prop(() => Number) flags?: number;
  @Prop(() => BigInt) points?: bigint;
  @Prop(() => [Number]) scores!: number[];
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => Spec.map(Number)) counters?: Map<string, number>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
// Write the current account state from an external system
export const syncAccount = async (title: string, owner: string): Promise<boolean> => {
  const result = await Accounts.replaceOne({ title }, { title, owner });
  return result.matchedCount === 1;
};

// Replace an account and return what it held
export const archiveAndReplace = async (title: string, owner: string) => {
  return Accounts.findOneAndReplace({ title }, { title, owner }, { returnDocument: "before" }).plain();
};
