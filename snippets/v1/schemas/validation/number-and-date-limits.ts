import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "people" })
class Person extends Entity {
  @Prop(() => Number, { min: 18, max: 120 }) // [!code highlight]
  age?: number;
  @Prop(() => Date, { min: new Date("2020-01-01") }) // [!code highlight]
  registered?: Date;
}
const People = client.connection.model(Person);
try {
  await People.create({ age: 200, registered: new Date("2019-01-01") });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "age": must be at most 120 [max]; "registered": must be at least 2020-01-01T00:00:00.000Z [min]
