import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "members" })
class Member extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" }) role!: Defaulted<"user" | "admin">;
  @Prop(() => Number, { default: 0 }) score!: Defaulted<number>;
}
const Members = client.connection.model(Member);
// ---cut---
await Members.updateOne({ name: "Zed" }, { $set: { score: 5 } }, { upsert: true });
const zed = await Members.findOne({ name: "Zed" }).plain();
console.log(zed?.role, zed?.score);
// → user 5
