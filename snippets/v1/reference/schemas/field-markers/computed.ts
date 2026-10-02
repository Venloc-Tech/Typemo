import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Person extends Entity {
  @Prop(() => String) first?: string;
  @Prop(() => String) last?: string;
  get fullName(): Computed<string> { // [!code highlight]
    return `${this.first ?? ""} ${this.last ?? ""}`.trim() as Computed<string>;
  }
}
const People = client.db().model(Person);
const person = await People.create({ first: "Ann", last: "Lee" });
console.log(person.fullName);
// → Ann Lee
console.log(person.$toPlain({ virtuals: true }).fullName);
// → Ann Lee
