import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "names", collation: { locale: "en", strength: 2 } }) // [!code highlight]
class Named extends Entity {
  @Prop(() => String) name?: string;
}
const Names = client.db().model(Named);
await client.db().init();
const [info] = await client.unsafeDriver().db("app").listCollections({ name: "names" }, { nameOnly: false }).toArray();
console.log(info?.options?.collation?.strength);
// → 2
