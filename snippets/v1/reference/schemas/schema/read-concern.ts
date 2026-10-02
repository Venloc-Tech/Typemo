import { Entity, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "ledger", readConcern: { level: "majority" } }) // [!code highlight]
class Ledger extends Entity {}
