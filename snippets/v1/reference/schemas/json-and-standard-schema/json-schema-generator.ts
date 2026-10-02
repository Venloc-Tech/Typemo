import { CollectionNaming, Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, StandardSchema, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
}
@Schema({ collection: "users", validator: true }) // [!code highlight]
class User extends Entity {
  @Prop(() => String, { required: true, minLength: 2, maxLength: 10, match: /^[a-z]+$/ }) name!: string;
  @Prop(() => Number, { min: 0, max: 150 }) age?: number;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" }) role!: Defaulted<"user" | "admin">;
  @Prop(() => String, { nullable: true }) nickname?: string | null;
  @Prop(() => [String]) tags?: string[];
  @Prop(() => Address) address?: Address;
  @Prop(() => BigInt) big?: bigint;
}
