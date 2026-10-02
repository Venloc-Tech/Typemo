import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// model: a required, a nullable and an optional field
@Schema({ collection: "profiles" })
class Profile extends Entity {
  @Prop(() => String, { required: true }) login!: string;
  @Prop(() => String, { nullable: true }) nickname?: string | null;
  @Prop(() => String) bio?: string;
}

// your code: the error at the application boundary
class __BadRequest__ extends Error {}

// sign-up: skip the optional field if there is none
export const register = async (login: string, bio?: string) => {
  const Profiles = client.connection.model(Profile);
  try {
    return await Profiles.create({ login, ...(bio === undefined ? {} : { bio }) });
  } catch (error) {
    throw new __BadRequest__((error as Error).message);
  }
};

// the user dropped the nickname: null, not removal
export const clearNickname = async (login: string) => {
  const Profiles = client.connection.model(Profile);
  await Profiles.updateOne({ login }, { $set: { nickname: null } });
};

await register("zed");
await clearNickname("zed");
const saved = await client.connection.model(Profile).findOne({ login: "zed" }).lean();
console.log(saved?.nickname, saved?.bio);
// → null undefined
