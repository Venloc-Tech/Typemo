import { Entity, Prop, Schema, TypemoClient, VersionError, Versioned } from "@venloc/typemo";
@Schema({ collection: "ledgers", optimisticConcurrency: true })
class Ledger extends Versioned(Entity) {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Ledgers = client.db().model(Ledger);
// ---cut---
const created = await Ledgers.create({ owner: "ann", balance: 10 });
const first = await Ledgers.findById(created._id).orFail();
const second = await Ledgers.findById(created._id).orFail();

first.balance = 20;
await first.$save();
console.log(first.__v);
// → 1

second.balance = 30;
await second.$save().catch((error) => console.log(error instanceof VersionError));
// → true
