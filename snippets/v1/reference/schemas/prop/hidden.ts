import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { hidden: true }) // [!code highlight]
  passwordHash?: Hidden<string>;
}
const Users = client.db().model(User);
const visible = await Users.find({ name: "gina" }).plain();
// → [{ _id: "…", name: "gina" }]
const selected = await Users.find({ name: "gina" }).select({ passwordHash: 1 }).lean();
// → [{ _id: ObjectId("…"), passwordHash: "h" }]
const all = await Users.find({ name: "gina" }).select({ "+passwordHash": true }).plain({ hidden: true });
// → [{ _id: "…", name: "gina", passwordHash: "h" }]
