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
const one = await Accounts.create({ title: "Main", owner: "alice" });
console.log(one.title, one.balance);
// → "Main" 0

const many = await Accounts.create([
  { title: "Salary", owner: "alice" },
  { title: "Savings", owner: "alice" },
]);
console.log(many.length);
// → 2

const inserted = await Accounts.insertOne({ title: "Cash", owner: "bob" });
console.log(inserted.owner);
// → "bob"
