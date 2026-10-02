import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "recent_logs", capped: { size: 4096, max: 5 } }) // [!code highlight]
class Log extends Entity {
  @Prop(() => Number, { required: true }) n!: number;
}

const Logs = client.db().model(Log);
await client.db().init();
for (let n = 1; n <= 7; n++) await Logs.create({ n });
const rows = await Logs.find().sort({ n: 1 }).plain();
console.log(rows.map((row) => row.n));
// → [3, 4, 5, 6, 7]
