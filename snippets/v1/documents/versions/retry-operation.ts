import { Entity, Prop, Schema, TypemoClient, VersionError, Versioned } from "@venloc/typemo";
@Schema({ collection: "ledgers", optimisticConcurrency: true })
class Ledger extends Versioned(Entity) {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Ledgers = client.db().model(Ledger);
// ---cut---
export const deposit = async (ledgerId: Ledger["_id"], amount: number) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ledger = await Ledgers.findById(ledgerId).orFail();
    ledger.balance += amount;
    try {
      await ledger.$save();
      return ledger.balance;
    } catch (error) {
      if (!(error instanceof VersionError)) throw error;
    }
  }
  throw new Error("the ledger is busy, try again later");
};
