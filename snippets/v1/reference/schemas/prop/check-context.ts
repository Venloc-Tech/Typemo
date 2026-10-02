import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Contact extends Entity {
  @Prop(() => String, {
    validate: async (value, context) =>
      value !== "bad" || `rejected in ${context.kind}:${context.operation}`,
  })
  email?: string;
}
const Contacts = client.db().model(Contact);
try {
  await Contacts.create({ email: "bad" });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "email": rejected in document:save [validator]
try {
  await Contacts.updateOne({ email: "a@b.c" }, { $set: { email: "bad" } });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "email": rejected in update:updateOne [validator]
