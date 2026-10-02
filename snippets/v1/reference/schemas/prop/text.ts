import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Article extends Entity {
  @Prop(() => String, { text: true }) // [!code highlight]
  title?: string;
  @Prop(() => String, { text: true }) // [!code highlight]
  body?: string;
}
const Articles = client.db().model(Article);
console.log(Articles.schema.describe().indexes);
// → [{ keys: { title: "text", body: "text" }, options: {} }]
