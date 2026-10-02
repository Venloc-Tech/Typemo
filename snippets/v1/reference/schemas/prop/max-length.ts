import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Signup extends Entity {
  @Prop(() => String, { maxLength: 20 }) // [!code highlight]
  login?: string;
}
const Signups = client.db().model(Signup);
try {
  await Signups.create({ login: "x".repeat(30) });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "login": must be at most 20 characters long [maxLength]
