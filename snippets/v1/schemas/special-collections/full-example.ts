import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({
  collection: "readings",
  timeseries: { timeField: "at", metaField: "sensor", granularity: "minutes", expireAfterSeconds: 3600 },
})
class Reading extends Entity {
  @Prop(() => Date, { required: true }) at!: Date;
  @Prop(() => String) sensor?: string;
  @Prop(() => Number) value?: number;
}

@Schema({ collection: "recent_alerts", capped: { size: 8192, max: 100 } })
class Alert extends Entity {
  @Prop(() => String, { required: true }) text!: string;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Readings = client.db().model(Reading);
const Alerts = client.db().model(Alert);

// start: collections are created with the right options
await client.db().init();

// write a measurement and an alert
export const record = async (sensor: string, value: number) => {
  await Readings.create({ at: new Date(), sensor, value });
  if (value > 100) await Alerts.create({ text: `${sensor} is too high` });
};
