import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Blob extends Entity {
  @Prop(() => Spec.binary({ subtype: 128 })) // [!code highlight]
  payload?: Types.Binary;
}
const Blobs = client.db().model(Blob);
const blob = await Blobs.create({ payload: new Types.Binary(new Uint8Array([3]), 128) });
console.log(blob.payload?.sub_type);
// → 128
