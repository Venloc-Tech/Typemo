import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "watched", changeStreamPreAndPostImages: true }) // [!code highlight]
class Watched extends Entity {}
const Docs = client.db().model(Watched);
await client.db().init();
const [info] = await client.unsafeDriver().db("app").listCollections({ name: "watched" }, { nameOnly: false }).toArray();
console.log(info?.options);
// → { changeStreamPreAndPostImages: { enabled: true } }
