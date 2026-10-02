import { CollectionNaming, Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ nested: true })
class Address {
  @Prop(() => String, { dbName: "c" }) city?: string;
}
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { dbName: "e", required: true }) email!: string;
  @Prop(() => Address) address?: Address;
  @Prop(() => [Address]) places?: Address[];
}
const Users = client.db().model(User);
console.log(Users.schema.toDbPath("email"));
// → e
console.log(Users.schema.toDbPath("address.city"));
// → address.c
console.log(Users.schema.toDbPath("places.0.city"));
// → places.0.c
console.log(Users.schema.toDbPath("address.nope"));
// → undefined
