import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Label extends Entity {
  @Prop(() => String, { get: (value) => `${value}!`, set: (value) => value.toUpperCase() })
  tag?: string;
}
const Labels = client.db().model(Label);
const label = Labels.new({ tag: "abc" });
console.log(label.tag);
// → ABC
console.log(label.$get("tag"));
// → ABC!
