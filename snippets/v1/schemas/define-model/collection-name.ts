import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema()
class UserProfile extends Entity {}

@Schema({ collection: "profiles" })
class Profile extends Entity {}

console.log(client.connection.model(UserProfile).collectionName);
// → userprofiles
console.log(client.connection.model(Profile).collectionName);
// → profiles
