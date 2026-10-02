import { CollectionNaming, Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
const names = ["User", "UserProfile", "Person", "Category", "Box", "Status", "Data", "Mouse", "Wife"].map(CollectionNaming.default);
console.log(names.join(" "));
// → users userprofiles people categories boxes status data mice wives
