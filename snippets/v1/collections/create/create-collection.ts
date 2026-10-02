import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "ledger", capped: { size: 65_536, max: 3 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true }) note!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Ledger = client.connection.model(LedgerEntry);
// ---cut---
console.log(await Ledger.createCollection());
// → true
console.log(await Ledger.createCollection());
// → false

for (const note of ["a", "b", "c", "d"]) await Ledger.create({ note });
console.log((await Ledger.find().lean()).map((entry) => entry.note));
// → ["b", "c", "d"]
