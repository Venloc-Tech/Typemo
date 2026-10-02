import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Person extends Entity {
  @Prop(() => Date, { min: new Date("2020-01-01") }) // [!code highlight]
  born?: Date;
}
const People = client.db().model(Person);
try {
  await People.create({ born: new Date("2019-01-01") });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "born": must be at least 2020-01-01T00:00:00.000Z [min]
