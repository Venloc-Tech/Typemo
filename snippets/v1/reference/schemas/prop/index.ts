import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Event extends Entity {
  @Prop(() => String, { index: -1 }) // [!code highlight]
  kind?: string;
}
const Events = client.db().model(Event);
console.log(Events.schema.describe().indexes);
// → [{ keys: { kind: -1 }, options: {} }]
