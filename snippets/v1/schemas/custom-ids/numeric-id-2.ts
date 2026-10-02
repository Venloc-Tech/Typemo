import { EntityWithId, Prop, Schema, TypemoClient, type Defaulted } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
@Schema({ collection: "counters" })
class Counter extends EntityWithId(() => Number) {
  @Prop(() => Number, { required: true, default: 0 }) hits!: Defaulted<number>;
}
const Counters = client.db().model(Counter);
// ---cut---
const first = await Counters.keysetPage({ sort: [["hits", "desc"]], limit: 2 });
console.log(first.items.map((row) => [row._id, row.hits]));
// → [[3, 5], [5, 0]]

const second = await Counters.keysetPage({ sort: [["hits", "desc"]], limit: 2, after: first.nextCursor });
console.log(second.items.map((row) => [row._id, row.hits]));
// → [[4, 0], [2, 0]]
