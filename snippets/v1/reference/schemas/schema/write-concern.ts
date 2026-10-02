import { Entity, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "ledger_writes", writeConcern: { w: "majority" } }) // [!code highlight]
class LedgerWrite extends Entity {}
