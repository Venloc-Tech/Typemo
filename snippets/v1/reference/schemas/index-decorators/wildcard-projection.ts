import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Index({ "$**": 1 }, { wildcardProjection: { title: 1 }, name: "wild" }) // [!code highlight]
@Schema()
class Article extends Entity {
  @Prop(() => String) title?: string;
}
const Articles = client.db().model(Article);
console.log(Articles.schema.describe().indexes);
// → [{ keys: { "$**": 1 }, options: { wildcardProjection: { title: 1 }, name: "wild" } }]
