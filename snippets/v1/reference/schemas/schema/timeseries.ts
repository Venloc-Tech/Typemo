import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({
  collection: "readings",
  timeseries: { timeField: "at", metaField: "sensor", granularity: "minutes", expireAfterSeconds: 3600 }, // [!code highlight]
})
class Reading extends Entity {
  @Prop(() => Date, { required: true }) at!: Date;
  @Prop(() => String) sensor?: string;
  @Prop(() => Number) value?: number;
}
const Readings = client.db().model(Reading);
await client.db().init();
const [info] = await client.unsafeDriver().db("app").listCollections({ name: "readings" }, { nameOnly: false }).toArray();
console.log(info?.options?.timeseries);
// → { timeField: "at", metaField: "sensor", granularity: "minutes", bucketMaxSpanSeconds: 86400, fixedBucketing: true }
