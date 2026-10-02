import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Contact extends Entity {
  @Prop(() => String, { validate: (value) => value.includes("@") || "must contain @" }) // [!code highlight]
  email?: string;
}
const Contacts = client.db().model(Contact);
try {
  await Contacts.create({ email: "nope" });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "email": must contain @ [validator]
