import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Member extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" }) // [!code highlight]
  role!: Defaulted<"user" | "admin">;
}
const Members = client.db().model(Member);
const member = await Members.create({ name: "Ann" });
console.log(member.role);
// → user
