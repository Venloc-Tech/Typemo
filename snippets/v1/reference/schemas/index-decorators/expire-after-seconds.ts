import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Index({ lastSeen: 1 }, { expireAfterSeconds: 60, name: "ttl" }) // [!code highlight]
@Schema()
class Session extends Entity {
  @Prop(() => Date) lastSeen?: Date;
}
const Sessions = client.db().model(Session);
console.log(Sessions.schema.describe().indexes);
// → [{ keys: { lastSeen: 1 }, options: { expireAfterSeconds: 60, name: "ttl" } }]
