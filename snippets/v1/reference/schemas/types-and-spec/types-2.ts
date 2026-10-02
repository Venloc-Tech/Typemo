import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Sample extends Entity {
  @Prop(() => BigInt) big?: bigint; // [!code highlight]
  @Prop(() => Types.Decimal128) price?: Types.Decimal128; // [!code highlight]
  @Prop(() => Types.UUID) token?: Types.UUID;
  @Prop(() => Types.ObjectId) owner?: Types.ObjectId;
}
const Samples = client.db().model(Sample);
const sample = await Samples.create({
  big: 9007199254740993n,
  price: Types.Decimal128.fromString("1.10"),
  token: "0a1b2c3d-0000-4000-8000-000000000001",
  owner: "6abcfab53690ef6b2db71493",
});
console.log(sample.$toPlain());
// → { _id: "…", big: "9007199254740993", price: "1.10", token: "0a1b2c3d-0000-4000-8000-000000000001", owner: "6abcfab53690ef6b2db71493" }
