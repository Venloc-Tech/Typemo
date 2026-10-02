import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "profiles" })
export class Profile extends Entity {
  @Prop(() => String, { required: true }) // required: present and not null
  login!: string;

  @Prop(() => String, { nullable: true }) // may be null
  nickname?: string | null;

  @Prop(() => String) // may be missing
  bio?: string;
}

const Profiles = client.connection.model(Profile);
const profile = await Profiles.create({ login: "ann", nickname: null });
console.log(profile.$toPlain());
// → { _id: "…", login: "ann", nickname: null }
