import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "members" })
class Member extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const, default: "user" }) role!: Defaulted<"user" | "admin">;
}
const Members = client.connection.model(Member);
// ---cut---
// a document written before the role field existed
await client.unsafeDriver().db("shop").collection("members").insertOne({ name: "Old" });

const asDocument = await Members.findOne({ name: "Old" }).orFail();
console.log(asDocument.role);
// → user
const asPlain = await Members.findOne({ name: "Old" }).plain();
console.log(asPlain);
// → { _id: "…", name: "Old" }
