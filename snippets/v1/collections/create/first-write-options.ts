import { ConfigurationError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true }) note!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Ledger = client.connection.model(LedgerEntry);
// ---cut---
try {
  await Ledger.create({ note: "first" });
} catch (error) {
  if (error instanceof ConfigurationError) console.log(error.message);
  // → LedgerEntry.create: the collection "ledger" does not exist, and MongoDB would create it as a plain collection without the options of the schema that can only be given at creation (capped); create it first: await connection.init(), or await LedgerEntry.ensureCollection()
}
