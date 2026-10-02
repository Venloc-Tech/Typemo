import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Person extends Entity {
  @Prop(() => Number, { min: 0, max: 150 }) // [!code highlight]
  age?: number;
}
const People = client.db().model(Person);
try {
  await People.create({ age: 200 });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "age": must be at most 150 [max]
