import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "profiles" })
class Profile extends Entity {
  @Prop(() => String, { required: true }) login!: string;
  @Prop(() => String, { nullable: true }) nickname?: string | null;
  @Prop(() => String) bio?: string;
}
const Profiles = client.connection.model(Profile);
// ---cut---
const withNull = await Profiles.create({ login: "a", nickname: null });
const without = await Profiles.create({ login: "b" });
console.log(withNull.nickname, without.nickname);
// → null undefined
try {
  await Profiles.create({ login: "c", bio: null } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string failed at path "bio" for null: null is not allowed on a path that is not nullable [null]
