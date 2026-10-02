import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "profiles" })
class Profile extends Entity {
  @Prop(() => String, { required: true }) login!: string;
  @Prop(() => String, { nullable: true }) nickname?: string | null;
}
const Profiles = client.connection.model(Profile);
// ---cut---
try {
  await Profiles.create({ login: "ann", nickname: undefined } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string | null failed at path "nickname" for undefined: undefined is never a value; omit the field instead [undefined]
