import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Address {
  @Prop(() => String, { index: true })
  city?: string;
}
@Schema()
class Shop extends Entity {
  @Prop(() => Address)
  address?: Address;
}
@Schema()
class Draft extends Entity {
  @Prop(() => Address, { excludeIndexes: true }) // [!code highlight]
  address?: Address;
}
const Shops = client.db().model(Shop);
const Drafts = client.db().model(Draft);
console.log(Shops.schema.describe().indexes);
// → [{ keys: { "address.city": 1 }, options: {} }]
console.log(Drafts.schema.describe().indexes);
// → []
