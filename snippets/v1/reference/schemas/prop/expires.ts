import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Session extends Entity {
  @Prop(() => Date, { expires: 3600 }) // [!code highlight]
  lastSeen?: Date;
}
const Sessions = client.db().model(Session);
console.log(Sessions.schema.describe().indexes);
// → [{ keys: { lastSeen: 1 }, options: { expireAfterSeconds: 3600 } }]
