import { CollectionNaming, Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, StandardSchema, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true, lowercase: true, minLength: 3 })
  name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" })
  role!: Defaulted<"user" | "admin">;
}
const Users = client.db().model(User);
const standard = Users["~standard"];
console.log(standard.version, standard.vendor);
// → 1 typemo
const good = await standard.validate({ name: " Zed " });
console.log(good);
// → { value: { _id: "…", name: "zed", role: "user" } }
const bad = await standard.validate({ name: "a" });
console.log(bad);
// → { issues: [{ message: "must be at least 3 characters long", path: ["name"] }] }
