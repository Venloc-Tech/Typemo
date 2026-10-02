import { EntityWithId, Prop, Schema, TypemoClient, type Defaulted } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "counters" })
class Counter extends EntityWithId(() => Number) {
  @Prop(() => Number, { required: true, default: 0 })
  hits!: Defaulted<number>;
}

const Counters = client.db().model(Counter);
await Counters.insertMany([1, 2, 3, 4, 5].map((_id) => ({ _id })));
await Counters.updateOne({ _id: 3 }, { $inc: { hits: 5 } });

const counter = await Counters.findById(3).orFail().lean();
console.log(counter);
// → { _id: 3, hits: 5 }
