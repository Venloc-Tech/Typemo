import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "audit_rows", autoIndex: false }) // [!code highlight]
class Row extends Entity {
  @Prop(() => String, { index: true })
  kind?: string;
}
const Rows = client.db().model(Row);
await client.db().init();
const indexes = await client.unsafeDriver().db("app").collection("audit_rows").indexes();
console.log(indexes.map((index) => index.name));
// → ["_id_"]
