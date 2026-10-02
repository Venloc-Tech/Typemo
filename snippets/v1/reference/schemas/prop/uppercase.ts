import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Price extends Entity {
  @Prop(() => String, { uppercase: true, minLength: 3, maxLength: 3 }) // [!code highlight]
  currency?: string;
}
const Prices = client.db().model(Price);
const price = await Prices.create({ currency: "eur" });
console.log(price.currency);
// → EUR
