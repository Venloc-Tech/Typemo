import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "recent_logs", capped: { size: 4096, max: 5 } }) // [!code highlight]
class Log extends Entity {
  @Prop(() => String) message?: string;
}
const Logs = client.db().model(Log);
await client.db().init();
const [info] = await client.unsafeDriver().db("app").listCollections({ name: "recent_logs" }, { nameOnly: false }).toArray();
console.log(info?.options);
// → { capped: true, size: 4096, max: 5 }
