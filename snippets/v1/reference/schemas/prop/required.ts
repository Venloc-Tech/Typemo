import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Signup extends Entity {
  @Prop(() => String, { required: true }) // [!code highlight]
  login!: string;
}
const Signups = client.db().model(Signup);
try {
  await Signups.create({} as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "login": the field is required [required]
