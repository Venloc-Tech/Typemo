import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "null_filters" })
class Profile extends Entity {
  @Prop(() => String, { required: true }) login!: string;
  @Prop(() => String, { nullable: true }) nickname?: string | null;
}
const Profiles = client.connection.model(Profile);
await Profiles.create({ login: "a", nickname: null });
await Profiles.create({ login: "b" });
await Profiles.create({ login: "c", nickname: "cc" });
// ---cut---
const nullOrMissing = await Profiles.find({ nickname: null }).sort({ login: 1 }).plain();
console.log(nullOrMissing.map((p) => p.login));
// → ["a", "b"]
const missing = await Profiles.find({ nickname: { $exists: false } }).plain();
console.log(missing.map((p) => p.login));
// → ["b"]
