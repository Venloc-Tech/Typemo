import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Sample extends Entity {
  @Prop(() => Types.Int32) // [!code highlight]
  count?: number;
}
const Samples = client.db().model(Sample);
try {
  await Samples.create({ count: 1.5 });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Int32 failed at path "count" for 1.5 (number): a fractional number is not an Int32 [integer]
try {
  await Samples.create({ count: 2 ** 40 });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Int32 failed at path "count" for 1099511627776 (number): out of the Int32 range [-2^31, 2^31 - 1] [range]
