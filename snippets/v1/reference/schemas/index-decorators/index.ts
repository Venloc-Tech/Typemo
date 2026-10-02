import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Index({ owner: 1, createdAt: -1 }, { name: "by_owner" }) // [!code highlight]
@Schema()
class Note extends Entity {
  @Prop(() => String) owner?: string;
  @Prop(() => Date) createdAt?: Date;
}
const Notes = client.db().model(Note);
console.log(Notes.schema.describe().indexes);
// → [{ keys: { owner: 1, createdAt: -1 }, options: { name: "by_owner" } }]
