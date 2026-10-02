import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({
  collection: "readings",
  timeseries: { timeField: "at", metaField: "sensor", granularity: "minutes" }, // [!code highlight]
})
class Reading extends Entity {
  @Prop(() => Date, { required: true }) at!: Date;
  @Prop(() => String) sensor?: string;
  @Prop(() => Number) value?: number;
}

const Readings = client.db().model(Reading);
await client.db().init();
await Readings.create({ at: new Date("2026-01-01T00:00:00Z"), sensor: "s1", value: 1 });
const rows = await Readings.find({ sensor: "s1" }).plain();
console.log(rows.map((row) => row.value));
// → [1]
