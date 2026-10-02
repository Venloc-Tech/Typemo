import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "profiles" })
class Profile extends Entity {
  @Prop(() => String, { required: true }) login!: string;
  @Prop(() => String, { nullable: true }) nickname?: string | null;
  @Prop(() => String) bio?: string;
}
const Profiles = client.connection.model(Profile);
await Profiles.create({ login: "eve", nickname: "e", bio: "hi" });
// ---cut---
await Profiles.updateOne({ login: "eve" }, { $set: { nickname: null } });
await Profiles.updateOne({ login: "eve" }, { $unset: { bio: "" } });
console.log(await Profiles.findOne({ login: "eve" }).lean());
// → { _id: ObjectId("…"), login: "eve", nickname: null }
try {
  await Profiles.updateOne({ login: "eve" }, { $unset: { login: 1 } } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "login": the field is required; $unset would remove it [required]
