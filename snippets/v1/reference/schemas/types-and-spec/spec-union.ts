import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Setting extends Entity {
  @Prop(() => Spec.union(String, Number)) // [!code highlight]
  value?: string | number;
}
const Settings = client.db().model(Setting);
try {
  await Settings.create({ value: true as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string | number failed at path "value" for true (boolean): no member accepts this value (members: string, number) [union-no-match]
