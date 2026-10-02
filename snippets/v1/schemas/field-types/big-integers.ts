import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "ledgers" })
class Ledger extends Entity {
  @Prop(() => BigInt, { required: true }) // [!code highlight]
  operations!: bigint;
}
const Ledgers = client.connection.model(Ledger);
const ledger = await Ledgers.create({ operations: 9007199254740993n });
console.log(ledger.operations);
// → 9007199254740993n
console.log(ledger.$toPlain().operations);
// → "9007199254740993"
