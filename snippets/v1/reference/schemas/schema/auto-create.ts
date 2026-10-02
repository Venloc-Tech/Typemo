import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "external_events", autoCreate: false }) // [!code highlight]
class ExternalEvent extends Entity {}
const Events = client.db().model(ExternalEvent);
const report = await client.db().init();
console.log(report.created);
// → []
const found = await client.unsafeDriver().db("app").listCollections({ name: "external_events" }).toArray();
console.log(found.length);
// → 0
