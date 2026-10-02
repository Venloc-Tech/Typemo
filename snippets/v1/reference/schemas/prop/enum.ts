import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Member extends Entity {
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" }) // [!code highlight]
  role!: Defaulted<"user" | "admin">;
}
const Members = client.db().model(Member);
try {
  await Members.create({ role: "root" as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "role": must be one of "user", "admin" [enum]
