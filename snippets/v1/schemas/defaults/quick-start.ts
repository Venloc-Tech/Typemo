import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "members" })
export class Member extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" })
  role!: Defaulted<"user" | "admin">;
}

const Members = client.connection.model(Member);
const member = await Members.create({ name: "Ann" });
console.log(member.role);
// → user
