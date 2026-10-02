import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ nested: true }) // [!code highlight]
class Name {
  @Prop(() => String, { required: true }) first!: string;
  @Prop(() => String, { required: true }) last!: string;
}
@Schema()
class Person extends Entity {
  @Prop(() => Name, { required: true })
  name!: Name;
}
const People = client.db().model(Person);
console.log(Object.keys(People.schema.describe().paths));
// → ["_id", "name", "name.first", "name.last"]
