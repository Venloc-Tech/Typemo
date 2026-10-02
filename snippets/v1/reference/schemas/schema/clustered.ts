import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "clustered_docs", clustered: { name: "by_id" } }) // [!code highlight]
class ClusteredDoc extends Entity {}
const Docs = client.db().model(ClusteredDoc);
await client.db().init();
const [info] = await client.unsafeDriver().db("app").listCollections({ name: "clustered_docs" }, { nameOnly: false }).toArray();
console.log(info?.options);
// → { clusteredIndex: { v: 2, key: { _id: 1 }, name: "by_id", unique: true } }
