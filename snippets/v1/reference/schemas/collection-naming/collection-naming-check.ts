import { CollectionNaming, Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
try {
  CollectionNaming.check("system.users", "User");
} catch (error) {
  console.log((error as Error).message);
}
// → User: "system." collections are reserved
try {
  CollectionNaming.check("a$b", "User");
} catch (error) {
  console.log((error as Error).message);
}
// → User: the collection name "a$b" cannot contain "$" or a null character
