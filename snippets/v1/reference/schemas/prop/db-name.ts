import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Contact extends Entity {
  @Prop(() => String, { dbName: "e" }) // [!code highlight]
  email?: string;
}
const Contacts = client.db().model(Contact);
await Contacts.create({ email: "a@b.c" });
const rows = await Contacts.find({ email: "a@b.c" }).plain();
console.log(rows[0]?.email);
// → a@b.c
console.log(Contacts.schema.toDbPath("email"));
// → e
