import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Profile extends Entity {
  @Prop(() => String, { nullable: true }) // [!code highlight]
  nickname?: string | null;
}
const Profiles = client.db().model(Profile);
const profile = await Profiles.create({ nickname: null });
console.log(profile.nickname);
// → null
