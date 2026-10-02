import { BulkWriteError, CastError, type CreateInput, type Defaulted, DocumentNotFoundError, DuplicateKeyError, Entity, Filters, fn, type Immutable, Prop, QueryError, type Replacement, Schema, Spec, StrictModeError, Timestamped, TypemoClient, type Update, type UpdateInput, type UpdatePipelineFor, UpdatePipelines, ValidationError, type WriteValue } from "@venloc/typemo";
@Schema()
class Line {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;
}
@Schema({ collection: "accounts" })
class Account extends Entity {
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
  @Prop(() => String, { immutable: true }) region?: Immutable<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
await Accounts.updateOne({ title: "Main", "lines.sku": "y" }, { $set: { "lines.$.qty": 0 } });
// → lines: [{ sku: "x", qty: 1 }, { sku: "y", qty: 0 }]
